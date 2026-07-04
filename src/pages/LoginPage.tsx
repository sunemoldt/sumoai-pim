import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Package, Loader2, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const REMEMBERED_EMAIL_KEY = "comtek_remembered_email";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [resetSent, setResetSent] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const saved = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (saved) {
      setEmail(saved);
      setRememberMe(true);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    if (rememberMe) {
      localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(REMEMBERED_EMAIL_KEY);
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast({ title: "Login fejlede", description: error.message, variant: "destructive" });
    } else {
      const params = new URLSearchParams(window.location.search);
      const next = params.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        window.location.href = next;
      }
    }
    setLoading(false);
  };


  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast({ title: "Fejl", description: error.message, variant: "destructive" });
    } else {
      setResetSent(true);
    }
    setLoading(false);
  };

  if (mode === "forgot") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-sm shadow-lg">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Package className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl font-semibold">Nulstil adgangskode</CardTitle>
            <p className="text-sm text-muted-foreground">
              {resetSent ? "Tjek din email for et nulstillingslink" : "Indtast din email for at nulstille"}
            </p>
          </CardHeader>
          <CardContent>
            {resetSent ? (
              <div className="space-y-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Vi har sendt en email til <strong>{email}</strong> med et link til at nulstille din adgangskode.
                </p>
                <Button variant="outline" className="w-full" onClick={() => { setMode("login"); setResetSent(false); }}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Tilbage til login
                </Button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Send nulstillingslink
                </Button>
                <Button variant="ghost" className="w-full" type="button" onClick={() => setMode("login")}>
                  <ArrowLeft className="h-4 w-4 mr-2" /> Tilbage til login
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
            <Package className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl font-semibold">Comtek PIM</CardTitle>
          <p className="text-sm text-muted-foreground">Log ind for at fortsætte</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Adgangskode</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="remember" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(checked === true)} />
              <Label htmlFor="remember" className="text-sm font-normal cursor-pointer">Husk mig</Label>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Log ind
            </Button>
            <Button variant="link" className="w-full text-sm" type="button" onClick={() => setMode("forgot")}>
              Glemt adgangskode?
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
