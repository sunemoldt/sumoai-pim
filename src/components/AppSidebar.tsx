import { NavLink } from "react-router-dom";
import { LayoutDashboard, Package, Truck, Settings, Download } from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/products", icon: Package, label: "Produkter" },
  { to: "/suppliers", icon: Truck, label: "Leverandører" },
  { to: "/import", icon: Download, label: "WC Import" },
  { to: "/settings", icon: Settings, label: "Indstillinger" },
];

export default function AppSidebar() {
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
    </aside>
  );
}
