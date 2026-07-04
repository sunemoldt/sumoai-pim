import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchProducts from "./tools/search-products";
import getProduct from "./tools/get-product";
import listSuppliers from "./tools/list-suppliers";

const projectRef =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "comtek-pim-mcp",
  title: "Comtek PIM",
  version: "0.1.0",
  instructions:
    "Tools for the Comtek PIM. Search and read master products and suppliers. Use `search_products` to find products by title/EAN/brand, `get_product` for full details incl. supplier offers, and `list_suppliers` to enumerate suppliers.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchProducts, getProduct, listSuppliers],
});
