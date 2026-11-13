import { AlertCircle, ArrowRight, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Card } from "./ui";
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
export function Loading({
  text = "Querying SQL warehouse…",
}: {
  text?: string;
}) {
  return (
    <Card className="flex min-h-72 flex-col items-center justify-center gap-4 p-8">
      <LoaderCircle className="size-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{text}</p>
      <p className="text-xs text-muted-foreground">
        A suspended warehouse may take a moment to start.
      </p>
    </Card>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <Card role="alert" className="gap-0 p-8">
      <AlertCircle className="mb-4 size-7 text-destructive" />
      <h2 className="mb-2 text-lg font-semibold">Request failed</h2>
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        {error.message}
      </p>
      {retry && (
        <Button variant="outline" className="mt-5" onClick={retry}>
          <RefreshCw />
          Try again
        </Button>
      )}
    </Card>
  );
}
export function ChartTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold leading-none">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
export function ExploreLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}
