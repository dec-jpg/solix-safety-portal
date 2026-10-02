// Starting qualification lists, picked by the PRESET variable on first boot.
// Everything can be edited inside the portal afterwards (Settings > Training types).
// months = default validity, used to suggest an expiry date when a card is added.
const common = [
  { name: 'Asbestos Awareness', required: true, months: 12 },
  { name: 'Manual Handling', months: 36 },
  { name: 'Working at Height', months: 36 },
  { name: 'PASMA', months: 60 },
  { name: 'Abrasive Wheels', months: 36 },
  { name: 'First Aid at Work', months: 36 },
  { name: 'Emergency First Aid at Work', months: 36 },
  { name: 'Fire Marshal', months: 36 },
];

module.exports = {
  glazing: [
    { name: 'CSCS card', required: true, months: 60 },
    ...common.slice(0, 3),
    { name: 'IPAF 3a / 3b', months: 60 },
    { name: 'PASMA', months: 60 },
    { name: 'Vacuum Lifter / Glass Handling', months: 36 },
    { name: 'NVQ Fenestration Installation' },
    { name: 'Silica Dust Awareness', months: 36 },
    ...common.slice(4),
  ],
  plumbing: [
    { name: 'CSCS / JIB-PMES card', required: true, months: 60 },
    ...common.slice(0, 3),
    { name: 'Gas Safe (ACS)', months: 60 },
    { name: 'Unvented Hot Water (G3)', months: 60 },
    { name: 'Water Regulations' },
    { name: 'Legionella Awareness', months: 36 },
    { name: 'Hot Works', months: 36 },
    ...common.slice(3),
  ],
  general: [
    { name: 'CSCS card', required: true, months: 60 },
    ...common,
    { name: 'SSSTS', months: 60 },
    { name: 'SMSTS', months: 60 },
  ],
};
