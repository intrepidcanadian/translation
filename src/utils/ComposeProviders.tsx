import React from "react";

type ProviderComponent = React.ComponentType<{ children: React.ReactNode }>;

interface ComposeProvidersProps {
  providers: ProviderComponent[];
  children: React.ReactNode;
}

/**
 * Flattens nested provider trees into a single component.
 * Instead of 7 levels of JSX nesting, pass providers as an ordered array.
 */
export function ComposeProviders({ providers, children }: ComposeProvidersProps) {
  return providers.reduceRight<React.ReactNode>(
    (acc, Provider) => <Provider>{acc}</Provider>,
    children,
  ) as React.ReactElement;
}
