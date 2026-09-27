let lastId = Date.now() * 1000
export function newDraftId() {
  lastId = Math.max(lastId + 1, Date.now() * 1000)
  return -lastId
}
