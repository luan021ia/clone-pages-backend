# PRD Kiwify vs implementação Clone Pages

Comparação do [PRD_Integracao_Kiwify.md](c:\Users\luan9\OneDrive\Área de Trabalho\PRD_Integracao_Kiwify.md) com o código atual do backend.

---

## ✅ O que já está alinhado

| PRD | Implementação |
|-----|----------------|
| Validação HMAC-SHA1 com token | `kiwify.service.ts` → `validateSignature(data, signature)` com `KIWIFY_TOKEN` |
| Assinatura no query `?signature=` | `kiwify.controller.ts` → `@Query('signature')` |
| Mapeamento de status (paid, renewed, refunded, etc.) | `determineAction(orderStatus)` — mesmo mapa do PRD |
| Prioridade de plano: 1) frequency, 2) offer_id, 3) full_price | `determinePlan(data)` — mesma ordem |
| ACTIVATE: criar usuário + licença | `handleActivate()` — cria usuário (email, nome, CPF, phone), cria/reativa licença com dias |
| RENEW: somar dias ao validUntil | `handleRenew()` → `renewLicense()` — soma dias (ou a partir de hoje se expirado) |
| DEACTIVATE (refund/chargeback/cancel) | `handleDeactivate()` → `deactivateLicense()` |
| ALERT_OVERDUE: não desativar | Apenas log; acesso mantido |
| Filtro por produto (opcional) | `isValidProduct(data)` com `KIWIFY_PRODUCT_ID` |
| Offer IDs para plano | `KIWIFY_OFFER_ID_ANUAL` e `KIWIFY_OFFER_ID_MENSAL` (opcional; a Kiwify pode enviar só `frequency` no payload) |

**Importante:** Os links de checkout (ex.: `pay.kiwify.com.br/Kfz7MJt`) são **apenas para a página de vendas**. Não usamos o código do link para saber se é mensal ou anual — a Kiwify envia isso no webhook em `Subscription.plan.frequency`. Se você criar novos links ou mudar preços, não precisa alterar nada no backend.

---

## ⚠️ Pequenas diferenças (aceitáveis)

| PRD | Nosso código | Observação |
|-----|--------------|------------|
| Fallback anual se `full_price >= 200` | Usamos `>= 250` | Mais conservador; evita confundir ofertas. |
| Cancelamento: opção “manter acesso até validUntil” | Desativamos na hora | Comportamento mais seguro; se quiser gracioso, dá para ajustar depois. |
| Campos `statusReason`, `overdueAt`, `deactivatedAt` | Não persistimos | Licença tem `isActive` + `expiresAt`; suficiente para o fluxo atual. |

---

## 📋 O que precisamos de você para configurar

1. **KIWIFY_TOKEN** — Token de Assinatura (Kiwify → Apps → Webhooks)
2. **KIWIFY_PRODUCT_ID** — ID do produto Clone Pages (opcional, recomendado para filtrar)
3. **KIWIFY_OFFER_ID_MENSAL** — ID(s) da oferta mensal (pode ser mais de um, separado por vírgula)
4. **KIWIFY_OFFER_ID_ANUAL** — ID(s) da oferta anual (idem)
5. **WEBHOOK_URL** — No painel Kiwify você vai configurar: `https://bclone.fabricadelowticket.com.br/webhooks/kiwify`

Os itens 1–4 entram no `.env` do backend (e nas variáveis de ambiente do Dokploy em produção).
