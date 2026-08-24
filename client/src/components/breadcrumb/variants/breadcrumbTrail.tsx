import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export type BreadcrumbTrailItem = {
  label: string;
  url?: string;
};

export function BreadcrumbTrail({ items }: { items: BreadcrumbTrailItem[] }) {
  if (!items.length) return null;

  const nodes: React.ReactNode[] = [];

  items.forEach((item, index) => {
    const isLast = index === items.length - 1;

    nodes.push(
      <BreadcrumbItem key={`item-${index}`}>
        {isLast || !item.url ? (
          <BreadcrumbPage>{item.label}</BreadcrumbPage>
        ) : (
          <BreadcrumbLink href={item.url}>{item.label}</BreadcrumbLink>
        )}
      </BreadcrumbItem>,
    );

    if (!isLast) {
      nodes.push(<BreadcrumbSeparator key={`sep-${index}`} />);
    }
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>{nodes}</BreadcrumbList>
    </Breadcrumb>
  );
}
