export const USER_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  DEACTIVATED: "DEACTIVATED"
});

export const USER_STATUS_VALUES = Object.values(USER_STATUS);

// Volunteer standing shown on the roster. See src/services/report.service.js.
export const STANDING = Object.freeze({
  NEW: "NEW",
  RELIABLE: "RELIABLE",
  SLIPPING: "SLIPPING",
  INACTIVE: "INACTIVE",
  DEACTIVATED: "DEACTIVATED"
});

// What staff have decided about a coordinator or volunteer. Staff only.
export const DECISION = Object.freeze({
  KEEP: "KEEP",
  WARN: "WARN",
  REMOVE: "REMOVE"
});

export const DECISION_VALUES = Object.values(DECISION);
