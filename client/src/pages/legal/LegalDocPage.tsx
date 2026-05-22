/**
 * client/src/pages/legal/LegalDocPage.tsx
 *
 * Public-readable legal document page at `#/legal/:slug`. Mounted in
 * App.tsx; reachable from the clickwrap checkboxes (new tab) AND from
 * the footer of MarketingLanding.
 *
 * Phase 4 — three slugs: terms, privacy, aup. Anything else renders a
 * "document not found" stub so a stale link doesn't blank the page.
 */
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AppHeader } from "@/components/layout/AppHeader";
import {
  LEGAL_DOCS,
  isLegalDocSlug,
  type LegalDocResponse,
} from "@/lib/legal";
import { MarkdownView } from "@/components/legal/MarkdownView";

export default function LegalDocPage() {
  const [, params] = useRoute<{ slug: string }>("/legal/:slug");
  const [, navigate] = useLocation();

  const slug = params?.slug;
  const valid = isLegalDocSlug(slug);

  const { data, isLoading, isError } = useQuery<LegalDocResponse | null>({
    queryKey: [`/api/legal/${slug ?? ""}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: valid,
    staleTime: 60 * 60 * 1000,
  });

  return (
    <div className="min-h-screen bg-white">
      <AppHeader logoOnly />
      <main className="mx-auto max-w-3xl px-4 py-8">
        {!valid ? (
          <Card>
            <CardContent className="pt-6 text-center space-y-3">
              <h1 className="text-xl font-semibold">Document not found</h1>
              <p className="text-sm text-muted-foreground">
                The legal document you requested doesn't exist.
              </p>
              <Button variant="outline" onClick={() => navigate("/")}>
                Back to home
              </Button>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="space-y-3">
            <div className="h-8 w-2/3 rounded bg-muted animate-pulse" />
            <div className="h-4 w-full rounded bg-muted animate-pulse" />
            <div className="h-4 w-5/6 rounded bg-muted animate-pulse" />
            <div className="h-4 w-4/6 rounded bg-muted animate-pulse" />
          </div>
        ) : isError || !data ? (
          <Card>
            <CardContent className="pt-6 text-center space-y-3">
              <h1 className="text-xl font-semibold">Couldn't load document</h1>
              <p className="text-sm text-muted-foreground">
                We weren't able to load the {LEGAL_DOCS[slug as keyof typeof LEGAL_DOCS]?.title ?? "document"} right now.
                Try refreshing the page.
              </p>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Refresh
              </Button>
            </CardContent>
          </Card>
        ) : (
          <article>
            <header className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight text-stone-900">
                {LEGAL_DOCS[data.slug].title}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Version <span className="font-mono">{data.version}</span>
              </p>
            </header>
            <MarkdownView source={data.content} className="prose-sm" />
          </article>
        )}
      </main>
    </div>
  );
}
