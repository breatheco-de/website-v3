import * as React from "react"

/**
 * Where portalled Popover / DropdownMenu content mounts. Null = document.body. A high-z fixed
 * surface (e.g. the proposal review drawer) provides itself so its menus stack above it.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null)

const PortalContainerProvider = PortalContainerContext.Provider

function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext)
}

export { PortalContainerProvider, usePortalContainer }
