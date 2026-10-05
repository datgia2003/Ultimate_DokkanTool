import { createContext, useContext } from 'react'

export const CausalityDraftContext = createContext({ rows: {}, update: () => {} })
export const useCausalityDrafts = () => useContext(CausalityDraftContext)
