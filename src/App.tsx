import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { forwardRef, lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import { Loader2 } from "lucide-react";

// Route-level code splitting: only the page you're on gets downloaded.
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const ProductListPage = lazy(() => import("@/pages/ProductListPage"));
const BulkPricingPage = lazy(() => import("@/pages/BulkPricingPage"));
const ProductDetailPage = lazy(() => import("@/pages/ProductDetailPage"));
const NewProductPage = lazy(() => import("@/pages/NewProductPage"));
const SupplierListPage = lazy(() => import("@/pages/SupplierListPage"));
const SupplierDetailPage = lazy(() => import("@/pages/SupplierDetailPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const DuplicateEansPage = lazy(() => import("@/pages/DuplicateEansPage"));
const EanSuggestionsPage = lazy(() => import("@/pages/EanSuggestionsPage"));
const MonitoringPage = lazy(() => import("@/pages/MonitoringPage"));
const AiInsightsPage = lazy(() => import("@/pages/AiInsightsPage"));
const N8nWorkflowsPage = lazy(() => import("@/pages/N8nWorkflowsPage"));
const ShopifyPage = lazy(() => import("@/pages/ShopifyPage"));
const QuoteListPage = lazy(() => import("@/pages/QuoteListPage"));
const QuoteEditorPage = lazy(() => import("@/pages/QuoteEditorPage"));
const CollectionsListPage = lazy(() => import("@/pages/CollectionsListPage"));
const CollectionDetailPage = lazy(() => import("@/pages/CollectionDetailPage"));
const CampaignListPage = lazy(() => import("@/pages/CampaignListPage"));
const CampaignEditorPage = lazy(() => import("@/pages/CampaignEditorPage"));
const PriceAlertsPage = lazy(() => import("@/pages/PriceAlertsPage"));
const EanLookupPage = lazy(() => import("@/pages/EanLookupPage"));
const SalesListPage = lazy(() => import("@/pages/SalesListPage"));
const SalesDetailPage = lazy(() => import("@/pages/SalesDetailPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const OAuthConsentPage = lazy(() => import("@/pages/OAuthConsentPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}


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
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/products" element={<ProductListPage />} />
        <Route path="/products/new" element={<NewProductPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/suppliers" element={<SupplierListPage />} />
        <Route path="/suppliers/:id" element={<SupplierDetailPage />} />
        
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/ai-insights" element={<AiInsightsPage />} />
        <Route path="/automations/n8n" element={<N8nWorkflowsPage />} />
        <Route path="/shopify" element={<ShopifyPage />} />
        <Route path="/quotes" element={<QuoteListPage />} />
        <Route path="/quotes/new" element={<QuoteEditorPage />} />
        <Route path="/quotes/:id" element={<QuoteEditorPage />} />
        <Route path="/sales" element={<SalesListPage />} />
        <Route path="/sales/:orderId" element={<SalesDetailPage />} />
        
        
        <Route path="/collections" element={<CollectionsListPage />} />
        <Route path="/collections/:id" element={<CollectionDetailPage />} />
        <Route path="/campaigns" element={<CampaignListPage />} />
        <Route path="/campaigns/new" element={<CampaignEditorPage />} />
        <Route path="/campaigns/:id" element={<CampaignEditorPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/bulk-pricing" element={<BulkPricingPage />} />
        <Route path="/price-alerts" element={<PriceAlertsPage />} />
        <Route path="/ean-lookup" element={<EanLookupPage />} />

        <Route path="/settings/duplicate-eans" element={<DuplicateEansPage />} />
        <Route path="/settings/ean-suggestions" element={<EanSuggestionsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
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
              <Suspense fallback={<PageFallback />}>
                <Routes>
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/.lovable/oauth/consent" element={<OAuthConsentPage />} />
                  <Route path="*" element={<AuthenticatedApp />} />
                </Routes>
              </Suspense>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </div>
  );
});

export default App;
