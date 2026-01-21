import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/services/users.service';
import { LicensesService } from '../../licenses/licenses.service';
import { KiwifyWebhookDto } from './dto/kiwify-webhook.dto';
import * as crypto from 'crypto';

export enum WebhookAction {
  ACTIVATE = 'ACTIVATE',
  RENEW = 'RENEW',
  DEACTIVATE_REFUND = 'DEACTIVATE_REFUND',
  DEACTIVATE_CHARGEBACK = 'DEACTIVATE_CHARGEBACK',
  DEACTIVATE_CANCELED = 'DEACTIVATE_CANCELED',
  ALERT_OVERDUE = 'ALERT_OVERDUE',
  IGNORE = 'IGNORE',
}

interface PlanInfo {
  plano: 'monthly' | 'yearly';
  dias: number;
}

@Injectable()
export class KiwifyService {
  private readonly logger = new Logger(KiwifyService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly licensesService: LicensesService,
  ) {}

  /**
   * Valida a assinatura HMAC-SHA1 do webhook
   */
  validateSignature(data: any, signature: string): boolean {
    const kiwifyToken = this.configService.get<string>('KIWIFY_TOKEN');
    
    if (!kiwifyToken) {
      this.logger.error('KIWIFY_TOKEN não configurado no .env');
      throw new BadRequestException('Configuração do webhook inválida');
    }

    const expectedSignature = crypto
      .createHmac('sha1', kiwifyToken)
      .update(JSON.stringify(data))
      .digest('hex');

    const isValid = signature === expectedSignature;
    
    if (!isValid) {
      this.logger.warn('Assinatura inválida recebida do webhook');
    }

    return isValid;
  }

  /**
   * Determina a ação baseada no status do pedido
   */
  determineAction(orderStatus: string): WebhookAction {
    const statusMap: Record<string, WebhookAction> = {
      // ATIVAR ACESSO
      'paid': WebhookAction.ACTIVATE,
      'approved': WebhookAction.ACTIVATE,
      
      // RENOVAR ACESSO
      'subscription_renewed': WebhookAction.RENEW,
      'renewed': WebhookAction.RENEW,
      
      // ALERTAR (não desativa)
      'overdue': WebhookAction.ALERT_OVERDUE,
      'delayed': WebhookAction.ALERT_OVERDUE,
      'waiting_payment': WebhookAction.ALERT_OVERDUE,
      
      // DESATIVAR - Reembolso
      'refunded': WebhookAction.DEACTIVATE_REFUND,
      
      // DESATIVAR - Chargeback
      'chargedback': WebhookAction.DEACTIVATE_CHARGEBACK,
      'chargeback': WebhookAction.DEACTIVATE_CHARGEBACK,
      'dispute': WebhookAction.DEACTIVATE_CHARGEBACK,
      
      // DESATIVAR - Cancelamento
      'canceled': WebhookAction.DEACTIVATE_CANCELED,
      'subscription_canceled': WebhookAction.DEACTIVATE_CANCELED,
    };

    return statusMap[orderStatus] || WebhookAction.IGNORE;
  }

  /**
   * Determina o plano do usuário com prioridade:
   * 1. Subscription.plan.frequency (mais confiável)
   * 2. Product.offer_id (backup)
   * 3. full_price (último recurso)
   */
  determinePlan(data: KiwifyWebhookDto): PlanInfo {
    // 1. Frequency (mais confiável)
    const frequency = data.Subscription?.plan?.frequency;
    if (frequency) {
      const frequencyLower = frequency.toLowerCase();
      if (['yearly', 'annual', 'anual'].includes(frequencyLower)) {
        this.logger.log('Plano identificado via frequency: yearly (365 dias)');
        return { plano: 'yearly', dias: 365 };
      }
      if (['monthly', 'mensal'].includes(frequencyLower)) {
        this.logger.log('Plano identificado via frequency: monthly (30 dias)');
        return { plano: 'monthly', dias: 30 };
      }
    }
    
    // 2. Offer ID (se configurado)
    const offerId = data.Product?.offer_id;
    const offerIdsAnual = this.configService.get<string>('KIWIFY_OFFER_ID_ANUAL')?.split(',') || [];
    const offerIdsMensal = this.configService.get<string>('KIWIFY_OFFER_ID_MENSAL')?.split(',') || [];
    
    if (offerId) {
      if (offerIdsAnual.includes(offerId.trim())) {
        this.logger.log('Plano identificado via offer_id: yearly (365 dias)');
        return { plano: 'yearly', dias: 365 };
      }
      if (offerIdsMensal.includes(offerId.trim())) {
        this.logger.log('Plano identificado via offer_id: monthly (30 dias)');
        return { plano: 'monthly', dias: 30 };
      }
    }
    
    // 3. Preço (fallback) - Usando os preços atualizados
    const valor = data.full_price || 0;
    this.logger.warn(`⚠️ Usando fallback de preço: R$ ${valor}`);
    
    // Anual: R$ 297 | Mensal: R$ 67
    // Considerando valor >= 250 como anual (mais seguro que 200)
    return valor >= 250
      ? { plano: 'yearly', dias: 365 }
      : { plano: 'monthly', dias: 30 };
  }

  /**
   * Verifica se o produto é válido (filtro opcional)
   */
  isValidProduct(data: KiwifyWebhookDto): boolean {
    const targetProductId = this.configService.get<string>('KIWIFY_PRODUCT_ID');
    
    // Se não estiver configurado, aceita qualquer produto
    if (!targetProductId) {
      return true;
    }

    const productId = data.Product?.product_id;
    return productId === targetProductId;
  }

  /**
   * Processa o webhook e executa a ação correspondente
   */
  async processWebhook(data: KiwifyWebhookDto): Promise<void> {
    const email = data.Customer?.email;
    
    if (!email) {
      throw new BadRequestException('Email do cliente não fornecido');
    }

    // Verificar se é produto válido
    if (!this.isValidProduct(data)) {
      this.logger.warn(`Webhook ignorado: produto ${data.Product?.product_id} não corresponde ao configurado`);
      return;
    }

    const orderStatus = data.order_status || '';
    const action = this.determineAction(orderStatus);
    const { plano, dias } = this.determinePlan(data);
    const nome = data.Customer?.full_name || 'Usuário';
    const cpf = data.Customer?.cpf;
    const phone = data.Customer?.mobile;

    this.logger.log(`📥 Webhook recebido: ${orderStatus} → ${action} (${plano}, ${dias} dias) para ${email}`);

    switch (action) {
      case WebhookAction.ACTIVATE:
        await this.handleActivate(email, nome, dias, plano, cpf, phone);
        break;

      case WebhookAction.RENEW:
        await this.handleRenew(email, dias);
        break;

      case WebhookAction.DEACTIVATE_REFUND:
      case WebhookAction.DEACTIVATE_CHARGEBACK:
      case WebhookAction.DEACTIVATE_CANCELED:
        await this.handleDeactivate(email, action);
        break;

      case WebhookAction.ALERT_OVERDUE:
        this.logger.warn(`⚠️ Pagamento atrasado para ${email} - Acesso mantido`);
        // Implementar lógica de alerta se necessário
        break;

      case WebhookAction.IGNORE:
        this.logger.log(`ℹ️ Evento ignorado: ${orderStatus}`);
        break;
    }
  }

  /**
   * Ativa ou cria licença para novo pagamento
   */
  private async handleActivate(
    email: string,
    nome: string,
    dias: number,
    plano: 'monthly' | 'yearly',
    cpf?: string,
    phone?: string,
  ): Promise<void> {
    try {
      // Buscar usuário por email
      let user = await this.usersService.findByEmail(email);

      if (!user) {
        try {
          // Criar novo usuário com senha = email
          user = await this.usersService.create({
            email,
            name: nome,
            password: email,
            cpf: cpf || undefined,
            phone: phone || undefined,
          });
          this.logger.log(`✅ Novo usuário criado: ${email}`);
        } catch (error) {
          // Se falhar por email já existir (concorrência), buscar novamente
          if (error instanceof Error && error.message.includes('already used')) {
            this.logger.warn(`Usuário ${email} foi criado simultaneamente. Buscando novamente...`);
            user = await this.usersService.findByEmail(email);
            if (!user) {
              throw new Error('Falha ao criar ou buscar usuário');
            }
          } else {
            throw error;
          }
        }
      } else {
        // Atualizar CPF e telefone se o usuário já existe mas não tem
        const updates: { cpf?: string; phone?: string } = {};
        if (cpf && !user.cpf) updates.cpf = cpf;
        if (phone && !user.phone) updates.phone = phone;
        
        if (Object.keys(updates).length > 0) {
          await this.usersService.update(user.id, updates);
          this.logger.log(`✅ Dados atualizados para usuário: ${email}`);
        }
      }

      // Verificar se já existe licença
      const existingLicense = await this.licensesService.getUserLicense(user.id);

      if (existingLicense) {
        // Atualizar licença existente (reativar se estiver inativa)
        await this.licensesService.reactivateLicense(user.id, dias);
        this.logger.log(`✅ Licença reativada para ${email}: +${dias} dias`);
      } else {
        // Criar nova licença
        await this.licensesService.createLicense(user.id, dias);
        this.logger.log(`✅ Nova licença criada para ${email}: ${dias} dias`);
      }
    } catch (error) {
      this.logger.error(`Erro ao ativar licença para ${email}:`, error);
      throw error;
    }
  }

  /**
   * Renova licença existente (soma dias)
   */
  private async handleRenew(email: string, dias: number): Promise<void> {
    try {
      const user = await this.usersService.findByEmail(email);

      if (!user) {
        this.logger.error(`Usuário não encontrado para renovação: ${email}`);
        throw new BadRequestException(`Usuário não encontrado: ${email}`);
      }

      await this.licensesService.renewLicense(user.id, dias);
      this.logger.log(`✅ Licença renovada para ${email}: +${dias} dias`);
    } catch (error) {
      this.logger.error(`Erro ao renovar licença para ${email}:`, error);
      throw error;
    }
  }

  /**
   * Desativa licença (reembolso, chargeback ou cancelamento)
   */
  private async handleDeactivate(
    email: string,
    action: WebhookAction,
  ): Promise<void> {
    try {
      const user = await this.usersService.findByEmail(email);

      if (!user) {
        this.logger.warn(`Usuário não encontrado para desativação: ${email}`);
        return; // Não é erro crítico, apenas log
      }

      await this.licensesService.deactivateLicense(user.id);
      
      const motivo = action.replace('DEACTIVATE_', '').toLowerCase();
      this.logger.log(`❌ Licença desativada para ${email}: ${motivo}`);
    } catch (error) {
      this.logger.error(`Erro ao desativar licença para ${email}:`, error);
      throw error;
    }
  }
}
