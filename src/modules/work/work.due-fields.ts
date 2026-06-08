export type StepForDueFields = {
  deadline: Date | null;
  done: boolean;
};

export type StepForDisplay = {
  deadline: Date | null;
  done: boolean;
  createdAt: Date;
  [key: string]: unknown;
};

export function computeDueFields(steps: StepForDueFields[]): {
  nextDueAt: Date | null;
  firstDueAt: Date | null;
} {
  const allDeadlines = steps
    .map((s) => s.deadline)
    .filter((d): d is Date => d !== null);

  const incompleteDeadlines = steps
    .filter((s) => !s.done && s.deadline)
    .map((s) => s.deadline as Date);

  return {
    firstDueAt: allDeadlines.length > 0 ? minDate(allDeadlines) : null,
    nextDueAt: incompleteDeadlines.length > 0 ? minDate(incompleteDeadlines) : null
  };
}

function minDate(dates: Date[]): Date {
  return dates.reduce((min, d) => (d.getTime() < min.getTime() ? d : min));
}

function deadlineSortKey(deadline: Date | null): number {
  return deadline ? deadline.getTime() : Number.MAX_SAFE_INTEGER;
}

export function sortStepsForDisplay<T extends StepForDisplay>(steps: T[], status: string): T[] {
  return [...steps].sort((a, b) => {
    if (status === "OPEN" && a.done !== b.done) {
      return a.done ? 1 : -1;
    }

    const deadlineDiff = deadlineSortKey(a.deadline) - deadlineSortKey(b.deadline);
    if (deadlineDiff !== 0) return deadlineDiff;

    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function resolveStatusAndClosedAt(options: {
  existingStatus: string;
  existingClosedAt: Date | null;
  explicitStatus?: string;
  steps?: StepForDueFields[];
  stepsUpdated?: boolean;
}): { status: string; closedAt: Date | null } {
  const { existingStatus, existingClosedAt, explicitStatus, steps, stepsUpdated } = options;

  if (stepsUpdated && steps && steps.length > 0) {
    const allDone = steps.every((s) => s.done);
    if (allDone) {
      return { status: "CLOSED", closedAt: existingClosedAt ?? new Date() };
    }
    if (existingStatus === "CLOSED") {
      return { status: "OPEN", closedAt: null };
    }
  }

  if (explicitStatus === "CLOSED") {
    return { status: "CLOSED", closedAt: existingClosedAt ?? new Date() };
  }
  if (explicitStatus === "OPEN") {
    return { status: "OPEN", closedAt: null };
  }

  return { status: existingStatus, closedAt: existingClosedAt };
}

export function formatWorkUnitForResponse<
  T extends {
    status: string;
    steps: StepForDisplay[];
  }
>(unit: T): T {
  return {
    ...unit,
    steps: sortStepsForDisplay(unit.steps, unit.status)
  };
}
