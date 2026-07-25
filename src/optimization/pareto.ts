export interface Objective<T extends object> {
  key: keyof T;
  direction: 'maximize' | 'minimize';
}

export function paretoFront<T extends object>(
  candidates: T[],
  objectives: Array<Objective<T>>,
): T[] {
  const dominates = (left: T, right: T): boolean => {
    let strictlyBetter = false;
    for (const objective of objectives) {
      const a = Number(left[objective.key]);
      const b = Number(right[objective.key]);
      const atLeastAsGood =
        objective.direction === 'maximize' ? a >= b : a <= b;
      const better = objective.direction === 'maximize' ? a > b : a < b;
      if (!atLeastAsGood) return false;
      if (better) strictlyBetter = true;
    }
    return strictlyBetter;
  };

  return candidates.filter(
    (candidate, index) =>
      !candidates.some(
        (other, otherIndex) =>
          otherIndex !== index && dominates(other, candidate),
      ),
  );
}
