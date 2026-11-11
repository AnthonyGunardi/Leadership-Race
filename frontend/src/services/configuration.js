const sourceNotices = {
  PRD_APPENDIX_A: 'Board source: PRD Appendix A transcription. Not yet reconciled with original workbook; use for prototype/demo.',
  JSON_IMPORT: 'Board source: JSON import. Format validation does not imply endorsement against original workbook.'
};

/** Source provenance is presented consistently on setup and the public board, including after duplication. */
export function describeBoardSource(source) {
  return sourceNotices[source] ?? null;
}
