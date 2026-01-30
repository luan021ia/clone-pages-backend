import { Controller, Get, Post, Query, Body, Res, HttpException, HttpStatus, Req, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
import { CloneService } from './clone.service';
import { CloneHistoryService } from './clone-history.service';
import { ExportService, ExportOptions } from './export.service';
import { SessionGuard } from '../../common/guards/session.guard';

@Controller()
export class CloneController {
  constructor(
    private readonly cloneService: CloneService,
    private readonly exportService: ExportService,
    private readonly cloneHistoryService: CloneHistoryService,
  ) {}

  /**
   * 🎯 NOVO: Endpoint para cópia estática independente
   * Faz fetch UMA VEZ, limpa tracking, retorna cópia estática
   */
  @Get('clone')
  async clonePage(
    @Query('url') url?: string,
    @Query('editMode') editMode?: string,
    @Query('injectCustom') injectCustom?: string,
    @Query('pixelId') pixelId?: string,
    @Query('gtagId') gtagId?: string,
    @Query('whatsappNumber') whatsappNumber?: string,
    @Query('clarityId') clarityId?: string,
    @Query('utmfyCode') utmfyCode?: string,
    @Res() res?: Response,
  ) {
    if (!url) {
      throw new HttpException('URL parameter is required', HttpStatus.BAD_REQUEST);
    }

    try {
      // ✅ DEBUG: Log dos parâmetros ANTES do processamento
      console.log('📥 [clonePage] Iniciando com parâmetros:', {
        url: url.substring(0, 50) + '...',
        editMode: editMode === 'true',
        injectCustom: injectCustom === 'true',
        pixelId: pixelId ? '***' : 'undefined',
        gtagId: gtagId ? '***' : 'undefined',
        whatsappNumber: whatsappNumber ? '***' : 'undefined',
        clarityId: clarityId ? '***' : 'undefined',
        utmfyCode: utmfyCode ? '(preenchido)' : 'undefined',
      });

      const { html, stats } = await this.cloneService.fetchAndProcessPage(url, {
        editMode: editMode === 'true',
        injectCustom: injectCustom === 'true',
        pixelId,
        gtagId,
        whatsappNumber,
        clarityId,
        utmfyCode,
      });

      console.log('📊 [CloneController] Cópia estática criada:', {
        url,
        htmlSize: `${(html.length / 1024).toFixed(2)}KB`,
        cleaning: stats,
      });

      if (res) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Clone-Stats', JSON.stringify(stats));
        res.send(html);
      }
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to clone page',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * ⚠️ MANTIDO: Endpoint antigo para compatibilidade
   * (Deprecated - usar /clone em vez disso)
   */
  @Get('render-page')
  async renderPage(
    @Query('url') url?: string,
    @Query('editMode') editMode?: string,
    @Query('injectCustom') injectCustom?: string,
    @Query('pixelId') pixelId?: string,
    @Query('gtagId') gtagId?: string,
    @Query('whatsappNumber') whatsappNumber?: string,
    @Query('clarityId') clarityId?: string,
    @Query('utmfyCode') utmfyCode?: string,
    @Res() res?: Response,
  ) {
    console.log('========================================');
    console.log('📥 [renderPage] ========== REQUISIÇÃO RECEBIDA ==========');
    console.log('📥 [renderPage] Query parameters RAW:', {
      url: url ? url.substring(0, 50) + '...' : 'undefined',
      editMode,
      injectCustom,
      pixelId,
      gtagId,
      whatsappNumber,
      clarityId,
      utmfyCode: utmfyCode ? `(${utmfyCode.substring(0, 50)}...)` : 'undefined',
    });

    console.log('📥 [renderPage] Tipos dos parâmetros:', {
      editMode: typeof editMode,
      injectCustom: typeof injectCustom,
      pixelId: typeof pixelId,
      gtagId: typeof gtagId,
      whatsappNumber: typeof whatsappNumber,
      clarityId: typeof clarityId,
      utmfyCode: typeof utmfyCode,
    });

    console.log('📥 [renderPage] Valores booleanos convertidos:', {
      editModeBool: editMode === 'true',
      injectCustomBool: injectCustom === 'true',
    });

    // Redirecionar para novo endpoint
    return this.clonePage(
      url,
      editMode,
      injectCustom,
      pixelId,
      gtagId,
      whatsappNumber,
      clarityId,
      utmfyCode,
      res,
    );
  }

  /**
   * ⚠️ MANTIDO: Endpoint antigo para compatibilidade
   * (Deprecated - usar /clone em vez disso)
   */
  @Get('render')
  async render(@Query('url') url?: string, @Res() res?: Response) {
    if (!url) {
      throw new HttpException('URL parameter is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const { html } = await this.cloneService.fetchAndProcessPage(url, {});
      if (res) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
      }
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to fetch page',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * ⚠️ MANTIDO: Endpoint antigo para compatibilidade com download
   * (Deprecated - usar /render-page em vez disso)
   */
  @Get('download-html')
  async downloadHtml(
    @Query('url') url?: string,
    @Query('editMode') editMode?: string,
    @Query('injectCustom') injectCustom?: string,
    @Query('pixelId') pixelId?: string,
    @Query('gtagId') gtagId?: string,
    @Query('whatsappNumber') whatsappNumber?: string,
    @Query('clarityId') clarityId?: string,
    @Query('utmfyCode') utmfyCode?: string,
    @Res() res?: Response,
  ) {
    console.log('📥 [downloadHtml] Redirecionando para renderPage');
    // Redirecionar para renderPage que já tem toda a lógica
    return this.renderPage(
      url,
      editMode,
      injectCustom,
      pixelId,
      gtagId,
      whatsappNumber,
      clarityId,
      utmfyCode,
      res,
    );
  }

  /**
   * 🎯 NOVO: Endpoint para injetar editor completo no HTML
   * Recebe HTML e injeta o script completo do editor
   * Usado quando reativando modo edição com HTML já salvo
   */
  @Post('inject-editor')
  async injectEditor(@Req() req: Request, @Res() res?: Response) {
    try {
      // Ler o body como texto puro do request stream
      let html = '';

      // Se o body já foi parseado pelo middleware (improvável com text/html)
      if (typeof req.body === 'string') {
        html = req.body;
      } else {
        // Ler diretamente do stream
        html = await new Promise<string>((resolve, reject) => {
          let data = '';
          req.on('data', (chunk: Buffer) => {
            data += chunk.toString('utf-8');
          });
          req.on('end', () => {
            resolve(data);
          });
          req.on('error', reject);
        });
      }

      if (!html || html.trim().length === 0) {
        if (res) {
          res.status(400).send('HTML body is required');
        }
        return;
      }

      console.log('🔧 [injectEditor] Injetando editor em HTML tamanho:', html.length, 'bytes');

      // Injetar editor no HTML
      const htmlWithEditor = this.cloneService.injectEditorScript(html);

      console.log('✅ [injectEditor] Editor injetado com sucesso! Novo tamanho:', htmlWithEditor.length, 'bytes');

      if (res) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(htmlWithEditor);
      }
    } catch (error: any) {
      console.error('❌ [injectEditor] Erro:', error.message);
      if (res) {
        res.status(500).send('Failed to inject editor: ' + error.message);
      }
    }
  }

  /**
   * 🔍 NOVO: Endpoint para analisar códigos de rastreamento em uma URL
   * Retorna lista detalhada de todos os rastreadores encontrados
   */
  @Get('analyze-tracking')
  async analyzeTracking(
    @Query('url') url?: string,
    @Res() res?: Response,
  ) {
    if (!url) {
      throw new HttpException('URL parameter is required', HttpStatus.BAD_REQUEST);
    }

    try {
      console.log('🔍 [analyzeTracking] Iniciando análise de tracking codes para:', url.substring(0, 50) + '...');

      // Fazer fetch do HTML original (sem limpar)
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new HttpException('Invalid URL protocol', HttpStatus.BAD_REQUEST);
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        throw new HttpException(
          `Failed to fetch page: ${response.status} ${response.statusText}`,
          HttpStatus.BAD_GATEWAY,
        );
      }

      const html = await response.text();
      console.log(`📥 [analyzeTracking] HTML obtido: ${(html.length / 1024).toFixed(2)}KB`);

      // Analisar tracking codes
      const analysis = this.cloneService.analyzeTrackingCodes(html);

      console.log('✅ [analyzeTracking] Análise concluída:', {
        total: analysis.totalFound,
        byCategory: analysis.byCategory,
      });

      if (res) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(analysis);
      }

      return analysis;
    } catch (error: any) {
      console.error('❌ [analyzeTracking] Erro:', error.message);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Error analyzing tracking codes: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 📦 NOVO: Endpoint para exportar página como ZIP
   */
  @Post('export-zip')
  async exportZip(
    @Body('html') html: string,
    @Body('originalUrl') originalUrl: string,
    @Body('options') options: ExportOptions,
    @Res() res: Response
  ) {
    if (!html) {
      throw new HttpException('HTML is required', HttpStatus.BAD_REQUEST);
    }

    try {
      console.log('📦 [exportZip] Iniciando export com opções:', options);

      const zipBuffer = await this.exportService.exportAsZip(
        html,
        originalUrl || 'Página Clonada',
        options
      );

      console.log('✅ [exportZip] ZIP gerado:', zipBuffer.length, 'bytes');

      // Enviar como download
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="clone-export.zip"');
      res.setHeader('Content-Length', zipBuffer.length);
      res.send(zipBuffer);

    } catch (error: any) {
      console.error('❌ [exportZip] Erro:', error);
      throw new HttpException(
        `Export failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Histórico de clonagens: registrar URL clonada (protegido por JWT)
   */
  @Post('clone/history')
  @UseGuards(SessionGuard)
  async createCloneHistory(@Req() req: Request & { user: { id: string } }, @Body('url') url: string) {
    if (!url || typeof url !== 'string' || !url.trim()) {
      throw new HttpException('url is required', HttpStatus.BAD_REQUEST);
    }
    const entry = await this.cloneHistoryService.create(req.user.id, url.trim());
    return { id: entry.id, url: entry.url, createdAt: entry.createdAt };
  }

  /**
   * Histórico de clonagens: listar últimos N dias do usuário (protegido por JWT)
   */
  @Get('clone/history')
  @UseGuards(SessionGuard)
  async getCloneHistory(
    @Req() req: Request & { user: { id: string } },
    @Query('days') days?: string,
  ) {
    const daysNum = days ? Math.min(Math.max(1, parseInt(days, 10) || 30), 365) : 30;
    const items = await this.cloneHistoryService.findByUser(req.user.id, daysNum);
    return { items };
  }
}

