# Kiwify: Eventos recebidos e comportamento da ferramenta

Cada tipo de evento que a Kiwify envia no webhook faz a nossa ferramenta se comportar de uma forma específica. Este documento descreve o mapeamento e o que acontece no Clone Pages.

---

## Resumo

| Evento Kiwify | `order_status` (exemplos) | Comportamento da ferramenta |
|---------------|---------------------------|-----------------------------|
| **Compra aprovada** | `paid`, `approved`, `compra_aprovada` | **Ativar:** cria/busca usuário, cria ou reativa licença com X dias (30 ou 365) |
| **Assinatura renovada** | `subscription_renewed`, `renewed` | **Renovar:** soma dias ao `expiresAt` da licença (mantém acesso) |
| **Assinatura atrasada** | `overdue`, `delayed`, `waiting_payment`, `subscription_late` | **Alertar:** não desativa; acesso mantido; log de aviso (Kiwify faz retentativas) |
| **Reembolso** | `refunded`, `compra_reembolsada` | **Desativar:** licença inativa e expiração zerada; acesso revogado na hora |
| **Chargeback** | `chargedback`, `chargeback`, `dispute` | **Desativar:** mesmo que reembolso; acesso revogado na hora |
| **Assinatura cancelada** | `canceled`, `subscription_canceled` | **Desativar:** licença inativa; acesso revogado |

---

## 1. Compra aprovada

**O que a Kiwify envia:** pagamento confirmado (primeira compra ou recompra).

**O que a ferramenta faz:**

1. Busca usuário pelo e-mail (ou cria novo com nome, e-mail, CPF, telefone do payload).
2. Se já existir licença: **reativa** com nova data (hoje + dias do plano).
3. Se não existir licença: **cria** licença ativa com `expiresAt` = hoje + 30 ou 365 dias (conforme plano).
4. Usuário passa a ter acesso até a data de expiração.

**Status aceitos:** `paid`, `approved`, `compra_aprovada`.

---

## 2. Assinatura renovada

**O que a Kiwify envia:** cobrança recorrente da assinatura foi paga.

**O que a ferramenta faz:**

1. Busca o usuário pelo e-mail.
2. **Soma** dias ao `expiresAt` da licença:
   - Se a licença ainda está ativa e não expirou: soma a partir do `expiresAt` atual.
   - Se expirou ou estava inativa: soma a partir de **hoje** (nova janela de acesso).
3. Licença continua ativa; acesso é estendido.

**Status aceitos:** `subscription_renewed`, `renewed`.

---

## 3. Assinatura atrasada

**O que a Kiwify envia:** cobrança falhou, mas ainda há tentativas automáticas.

**O que a ferramenta faz:**

1. **Não desativa** a licença.
2. Registra log de aviso (ex.: "Pagamento atrasado para email@... - Acesso mantido").
3. Acesso segue até o `expiresAt` já definido (ou até a Kiwify enviar reembolso/cancelamento).

**Motivo:** a Kiwify faz retentativas; pode ser problema temporário de cartão. Desativar na hora cortaria acesso desnecessariamente.

**Status aceitos:** `overdue`, `delayed`, `waiting_payment`, `subscription_late`.

---

## 4. Reembolso

**O que a Kiwify envia:** cliente recebeu reembolso.

**O que a ferramenta faz:**

1. Busca o usuário pelo e-mail.
2. **Desativa** a licença: `isActive = false` e `expiresAt` = hoje (considerado expirado).
3. Acesso é revogado **na hora** (não espera fim do período).

**Status aceitos:** `refunded`, `compra_reembolsada`.

---

## 5. Chargeback

**O que a Kiwify envia:** contestação da compra no cartão (chargeback/dispute).

**O que a ferramenta faz:**

1. Mesmo fluxo do reembolso: desativa a licença e zera a expiração.
2. Acesso revogado **na hora**.

**Status aceitos:** `chargedback`, `chargeback`, `dispute`.

---

## 6. Assinatura cancelada

**O que a Kiwify envia:** assinatura foi cancelada (pelo cliente ou pela Kiwify).

**O que a ferramenta faz:**

1. Desativa a licença: `isActive = false`, `expiresAt` = hoje.
2. Acesso revogado na hora.

**Status aceitos:** `canceled`, `subscription_canceled`.

*(Opcional futuro: manter acesso até o fim do período já pago; hoje o comportamento é revogar na hora.)*

---

## Onde isso está no código

- **Mapeamento status → ação:** `kiwify.service.ts` → `determineAction(orderStatus)`.
- **Execução por ação:** `processWebhook()` → `handleActivate`, `handleRenew`, `handleDeactivate`, e branch `ALERT_OVERDUE` (só log).
- **Licenças:** `licenses.service.ts` → `createLicense`, `renewLicense`, `deactivateLicense`, `reactivateLicense`.

---

**Referência:** PRD Integração Kiwify + [documentação Kiwify Webhooks](https://kiwify.notion.site/Webhooks-pt-br-c77eb84be10c42e6bb97cd391bca9dce).
