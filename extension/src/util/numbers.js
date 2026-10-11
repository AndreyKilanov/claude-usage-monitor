const num = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value))

module.exports = { num }
