// Older retained contexts without a preference preserve their strict treatment.
export const calendarCoverageRequired = context => context.calendar_settings?.require_calendar_coverage ?? true;
export const calendarFallbackNotice = 'Holiday calendar coverage is optional. Dates without an entered calendar use the recorded work schedule; holidays in entered calendars still apply.';
