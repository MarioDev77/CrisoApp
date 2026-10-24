import { api } from "@/lib/api";
import { taxasVigentes } from "@/lib/servicos";
export const GET = api({ auth: ["cliente", "loja", "admin"] }, async () => taxasVigentes());
