/**
 * DTOs para o payload do webhook Kiwify
 * Baseado na documentação oficial e no PRD de integração
 */

export class CustomerDto {
  email?: string;
  full_name?: string;
  mobile?: string;
  cpf?: string;
  ip?: string;
}

export class ProductDto {
  product_id?: string;
  product_name?: string;
  offer_id?: string;
}

export class SubscriptionPlanDto {
  id?: string;
  name?: string;
  /** Pode vir em PT/EN/ES: monthly, mensal, month, mês, yearly, anual, year, etc. */
  frequency?: string;
  qty_charges?: number;
}

export class SubscriptionDto {
  id?: string;
  subscription_id?: string;
  start_date?: string;
  next_payment?: string;
  status?: string;
  plan?: SubscriptionPlanDto;
  access_url?: string | null;
}

export class KiwifyWebhookDto {
  order_id?: string;
  order_ref?: string;
  order_status?: string;
  payment_method?: string;
  store_id?: string;
  payment_merchant_id?: string;
  installments?: number;
  card_type?: string;
  card_last4digits?: string;
  full_price?: number;
  created_at?: string;
  updated_at?: string;
  approved_date?: string;
  refunded_at?: string | null;
  /** ID do produto (pode vir na raiz ou em Product.product_id) */
  product_id?: string;

  Customer?: CustomerDto;
  Product?: ProductDto;
  Subscription?: SubscriptionDto;
}
