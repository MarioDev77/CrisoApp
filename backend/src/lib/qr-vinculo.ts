/**
 * Vínculo QR de crédito ↔ cliente. A loja identifica o cliente (QR de identificação ou busca) e o `qr/gerar` grava
 * `id_cliente`. Quem tenta usar um QR reservado para OUTRA pessoa é barrado em `qr/validar` e de novo em `qr/confirmar`
 * (dentro da transação, com o QR travado FOR UPDATE). QR sem vínculo (loja não identificou) segue valendo como antes,
 * a menos que QR_CREDITO_EXIGE_CLIENTE=true.
 */
export type VinculoQr = "livre" | "meu" | "outro";
export const vinculoQr = (qrIdCliente: number | null | undefined, usuarioId: number): VinculoQr =>
  qrIdCliente == null ? "livre" : qrIdCliente === usuarioId ? "meu" : "outro";
export const MSG_QR_OUTRO_CLIENTE = "Este QR Code foi gerado para outro cliente.";
