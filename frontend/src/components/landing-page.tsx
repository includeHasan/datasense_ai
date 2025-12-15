import Link from "next/link";
import {
  Database,
  MessageSquareText,
  LineChart,
  ShieldCheck,
  FileDown,
  Pin,
  ArrowRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STEPS = [
  {
    title: "Connect",
    description: "Upload a CSV, JSON, or Excel file, or point at a Postgres database.",
  },
  {
    title: "Ask",
    description: "Type a question in plain English — no SQL required.",
  },
  {
    title: "Get an answer",
    description: "A narrated insight, a chart, and the SQL behind it, every time.",
  },
];

const FEATURES = [
  {
    icon: Database,
    title: "Any source, one interface",
    description:
      "Files and databases are all normalized to SQL under the hood, so the agent works the same way whether you connect a spreadsheet or a live database.",
  },
  {
    icon: MessageSquareText,
    title: "Plain-English questions",
    description:
      "Ask follow-ups the way you'd ask a colleague. The agent keeps conversation context turn to turn.",
  },
  {
    icon: LineChart,
    title: "Narrative and chart, together",
    description:
      "Every answer pairs a written explanation with a chart built from a validated spec — never guesswork rendering.",
  },
  {
    icon: ShieldCheck,
    title: "Read-only, always",
    description:
      "Every query is guarded to SELECT-only. Your source data is never mutated, no matter what's asked.",
  },
  {
    icon: Pin,
    title: "Pin what matters",
    description: "Pin any answer or chart to a dashboard to track it over time.",
  },
  {
    icon: FileDown,
    title: "Export the report",
    description: "Turn a conversation into a shareable report you can hand off in seconds.",
  },
];

export function LandingPage() {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-20 px-6 py-10 sm:py-14">
        {/* Nav */}
        <nav className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-mono text-lg font-bold tracking-[0.2em] text-foreground uppercase">
            DataSense<span className="text-primary">·</span>AI
          </span>
          <div className="flex items-center gap-2">
            <Link href="/demo">
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
                Live demo
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="sm">
                Log in
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </nav>

        {/* Hero */}
        <section className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex flex-col items-start gap-6">
            <span className="rounded-full border border-border bg-secondary px-3 py-1 font-mono text-xs tracking-wide text-secondary-foreground uppercase">
              Self-serve AI data analyst
            </span>
            <h1 className="font-heading text-4xl leading-[1.1] font-semibold tracking-tight text-foreground sm:text-5xl">
              Ask your data anything.
              <br />
              <span className="text-primary">Skip the SQL.</span>
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted-foreground">
              Connect a file or a database, ask a question in plain English, and
              get a narrated answer, a chart, and an exportable report — with
              the SQL always one click away.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/register">
                <Button size="lg" className="gap-1.5">
                  Get started free
                  <ArrowRight className="size-4" />
                </Button>
              </Link>
              <Link href="/demo">
                <Button variant="outline" size="lg">
                  Try the live demo
                </Button>
              </Link>
            </div>
            <p className="font-mono text-xs tracking-wide text-muted-foreground">
              No credit card · Connect a source in under a minute
            </p>
          </div>

          <div className="receipt-tear receipt-unfurl flex flex-col gap-4 rounded-b-md bg-greenbar p-5 ring-1 ring-foreground/10">
            <div className="flex items-center justify-between border-b border-dashed border-foreground/25 pb-3 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
              <span>DataSense · AI</span>
              <span>Receipt #0001</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                Question
              </span>
              <p className="font-mono text-sm text-foreground">
                &ldquo;Which product category drove the most revenue last
                quarter?&rdquo;
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                Answer
              </span>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Home &amp; Kitchen led with $128,400 in revenue, up 14% quarter
                over quarter — outpacing every other category.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                SQL
              </span>
              <pre className="overflow-x-auto rounded-sm bg-background p-3 font-mono text-xs text-foreground ring-1 ring-foreground/10">
{`select category, sum(revenue) as total
from order_items
where quarter = 'Q2'
group by category
order by total desc;`}
              </pre>
            </div>
            <div className="flex items-center justify-center gap-1.5 border-t border-dashed border-foreground/25 pt-3 font-mono text-[11px] tracking-wider text-primary uppercase">
              <ShieldCheck className="size-3.5" />
              Verified · read-only query
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="flex flex-col gap-8">
          <div className="flex flex-col items-center gap-2">
            <span className="font-mono text-xs tracking-wider text-primary uppercase">
              How it works
            </span>
            <h2 className="font-heading text-center text-2xl font-semibold tracking-tight text-foreground">
              From question to answer in three steps
            </h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <div
                key={step.title}
                className="flex flex-col gap-2 border-t-2 border-border pt-4"
              >
                <span className="font-mono text-2xl font-semibold text-primary tabular-nums">
                  0{index + 1}
                </span>
                <h3 className="font-heading text-base font-medium text-foreground">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="flex flex-col gap-8">
          <div className="flex flex-col items-center gap-2">
            <span className="font-mono text-xs tracking-wider text-primary uppercase">
              Features
            </span>
            <h2 className="font-heading text-center text-2xl font-semibold tracking-tight text-foreground">
              Everything you need, nothing you don&apos;t
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <Card
                key={feature.title}
                className="h-full transition duration-200 hover:-translate-y-0.5 hover:ring-primary/40"
              >
                <CardHeader>
                  <div className="flex size-9 items-center justify-center rounded-md bg-secondary ring-1 ring-foreground/5">
                    <feature.icon className="size-5 text-primary" />
                  </div>
                  <CardTitle className="mt-3">{feature.title}</CardTitle>
                  <CardDescription className="mt-1 leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="greenbar-bg flex flex-col items-center gap-4 rounded-xl bg-greenbar px-6 py-14 text-center ring-1 ring-foreground/10">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
            Open your books, ask your first question.
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            No credit card needed. Connect a source and get your first
            narrated answer in under a minute.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/register">
              <Button size="lg" className="gap-1.5">
                Get started free
                <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Link href="/demo">
              <Button variant="outline" size="lg">
                Try the live demo
              </Button>
            </Link>
          </div>
        </section>

        <footer className="flex items-center justify-between border-t border-border py-6 text-xs text-muted-foreground">
          <span className="font-mono uppercase tracking-wide">
            DataSense·AI
          </span>
          <span>Ask your data, not a query builder.</span>
        </footer>
      </div>
    </div>
  );
}
