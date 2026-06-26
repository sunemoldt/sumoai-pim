import { PartnerAdsFeedCard } from "@/components/PartnerAdsFeedCard";

export default function FeedsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Produkt-feeds</h1>
        <p className="text-sm text-muted-foreground">
          Affiliate- og prisportals-feeds genereret af PIM. Brug URL'erne nedenfor hos modtageren.
        </p>
      </div>
      <PartnerAdsFeedCard />
    </div>
  );
}
