// A date with no entered public holidays is treated as having none, so each scheduled working day counts.
export const holidaysMissingNotice = date => {
  const year = date.slice(0, 4);
  return `No public holidays are entered for ${year} yet, so a public holiday in ${year} is counted as a normal working day. HR can add them in Settings → Policies → Holidays.`;
};
