// The same messages as JSON text: kept ONLY as the baseline for the JSON-vs-binary comparison.
export const encodeSnapshotJson = (snap) => JSON.stringify(snap);
export const decodeSnapshotJson = (text) => JSON.parse(text);
export const encodeInputsJson = (inputs) => JSON.stringify(inputs);
export const decodeInputsJson = (text) => JSON.parse(text);
