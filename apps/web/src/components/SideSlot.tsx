import { createContext } from 'react'

/**
 * The column in the shell between the sidebar and the content, where a page can put a list that
 * slides out of the sidebar (the Review's queue). Empty, it takes no room.
 */
export const SideSlot = createContext<HTMLElement | null>(null)
