import { NavLink } from "react-router-dom";
import { LayoutDashboard, Package, Truck, Settings, Download, LogOut, Activity, Workflow, ShoppingBag, FileText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/products", icon: Package, label: "Produkter" },
  { to: "/quotes", icon: FileText, label: "Tilbud" },
  { to: "/suppliers", icon: Truck, label: "Leverandører" },
  { to: "/import", icon: Download, label: "WC Import" },
  { to: "/shopify", icon: ShoppingBag, label: "Shopify" },
  { to: "/monitoring", icon: Activity, label: "Monitoring" },
  { to: "/automations/n8n", icon: Workflow, label: "n8n Workflows" },
  { to: "/settings", icon: Settings, label: "Indstillinger" },
];

export default function AppSidebar() {
  const { signOut, user } = useAuth();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <Package className="h-6 w-6 text-primary" />
        <span className="text-lg font-semibold text-foreground">Comtek PIM</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-border p-3 space-y-2">
        <p className="truncate px-3 text-xs text-muted-foreground">{user?.email}</p>
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          Log ud
        </button>
      </div>
    </aside>
  );
}
