export function createRequestGuard() {
  let locked = false

  return {
    begin() {
      if (locked) return false
      locked = true
      return true
    },
    end() {
      locked = false
    },
    isLocked() {
      return locked
    },
  }
}
