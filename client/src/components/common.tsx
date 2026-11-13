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
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-.04em] lg:text-[34px]">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
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
    <Card role="alert" className="p-8">
      <AlertCircle className="mb-4 size-7 text-amber-600" />
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
        <h2 className="text-sm font-semibold">{title}</h2>
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
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
    >
      {children}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}
