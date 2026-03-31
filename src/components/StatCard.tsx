import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  description?: string;
  variant?: "default" | "success" | "warning" | "destructive";
  onClick?: () => void;
}

const variantStyles = {
  default: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

export default function StatCard({ title, value, icon, description, variant = "default" }: StatCardProps) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-secondary ${variantStyles[variant]}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
