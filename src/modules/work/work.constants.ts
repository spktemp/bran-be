export const WORK_STATUSES = ["OPEN", "CLOSED"] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
