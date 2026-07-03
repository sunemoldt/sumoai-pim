import AiInsightsWidget from "@/components/AiInsightsWidget";

export default function AiInsightsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">AI-indsigter</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Automatiske anbefalinger baseret på pris, lager, avance og trafik.
        </p>
      </div>
      <AiInsightsWidget />
    </div>
  );
}
