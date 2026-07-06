import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { forwardRef } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import DashboardPage from "@/pages/DashboardPage";
import ProductListPage from "@/pages/ProductListPage";
import ProductDetailPage from "@/pages/ProductDetailPage";
import NewProductPage from "@/pages/NewProductPage";
import SupplierListPage from "@/pages/SupplierListPage";
import SupplierDetailPage from "@/pages/SupplierDetailPage";
import SettingsPage from "@/pages/SettingsPage";
import DuplicateEansPage from "@/pages/DuplicateEansPage";
import ImportPage from "@/pages/ImportPage";
import MonitoringPage from "@/pages/MonitoringPage";
import AiInsightsPage from "@/pages/AiInsightsPage";
import N8nWorkflowsPage from "@/pages/N8nWorkflowsPage";
import ShopifyPage from "@/pages/ShopifyPage";
import QuoteListPage from "@/pages/QuoteListPage";
import QuoteEditorPage from "@/pages/QuoteEditorPage";
import FeedsPage from "@/pages/FeedsPage";
import CollectionsListPage from "@/pages/CollectionsListPage";
import CollectionDetailPage from "@/pages/CollectionDetailPage";
import LoginPage from "@/pages/LoginPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import OAuthConsentPage from "@/pages/OAuthConsentPage";
import NotFound from "@/pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache aggressively to reduce DB load. Most PIM data changes via explicit user actions
      // that already call queryClient.invalidateQueries(...).
      staleTime: 5 * 60 * 1000, // 5 min — treat data as fresh, no auto refetch
      gcTime: 30 * 60 * 1000, // 30 min — keep in memory across navigations
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

function AuthenticatedApp() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/products" element={<ProductListPage />} />
        <Route path="/products/new" element={<NewProductPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/suppliers" element={<SupplierListPage />} />
        <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/ai-insights" element={<AiInsightsPage />} />
        <Route path="/automations/n8n" element={<N8nWorkflowsPage />} />
        <Route path="/shopify" element={<ShopifyPage />} />
        <Route path="/quotes" element={<QuoteListPage />} />
        <Route path="/quotes/new" element={<QuoteEditorPage />} />
        <Route path="/quotes/:id" element={<QuoteEditorPage />} />
        <Route path="/feeds" element={<FeedsPage />} />
        <Route path="/collections" element={<CollectionsListPage />} />
        <Route path="/collections/:id" element={<CollectionDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

const App = forwardRef<HTMLDivElement>(function App(_props, ref) {
  return (
    <div ref={ref} className="min-h-screen bg-background">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/.lovable/oauth/consent" element={<OAuthConsentPage />} />
                <Route path="*" element={<AuthenticatedApp />} />

              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </div>
  );
});

export default App;
