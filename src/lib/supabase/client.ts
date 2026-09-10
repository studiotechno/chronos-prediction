import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Client navigateur.
 *
 * Les autres produits maison passent ici une option `lock` neutralisée, parce
 * que l'API Navigator Lock figeait la connexion dans certains environnements.
 * supabase-js 2.116 la déprécie : la coordination des rafraîchissements est
 * désormais native et sans verrou, et la passer ne produit plus qu'un
 * avertissement en console. On s'en dispense donc.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}
