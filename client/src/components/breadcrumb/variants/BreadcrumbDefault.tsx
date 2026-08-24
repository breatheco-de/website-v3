import { BreadcrumbTrail, type BreadcrumbTrailItem } from "./breadcrumbTrail";

interface BreadcrumbDefaultProps {
  data: {
    items: BreadcrumbTrailItem[];
  };
}

export default function BreadcrumbDefault({ data }: BreadcrumbDefaultProps) {
  const { items = [] } = data;
  return <BreadcrumbTrail items={items} />;
}
