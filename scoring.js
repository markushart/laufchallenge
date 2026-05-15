function parsePace(pace) {
  if (!pace) return null;
  const s = String(pace).replace(',', '.');
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    return parseFloat(m) + parseFloat(sec || '0') / 60;
  }
  return parseFloat(s);
}

function calcRunPoints(km, pace) {
  return (km >= 4 && pace && pace < 7) ? Math.floor(km / 4) : 0;
}

function calcSportPoints(minutes) {
  return Math.floor(minutes / 30);
}

function calcBikePoints(km) {
  return Math.floor(km / 12);
}

function calcWeightPoints(startWeight, currentWeight) {
  const loss = startWeight - currentWeight;
  let points = 0;
  if (loss >= 2) points = Math.floor(loss / 2) * 2;
  else if (loss > 0) points = 1;
  return { loss, points };
}

module.exports = {
  parsePace,
  calcRunPoints,
  calcSportPoints,
  calcBikePoints,
  calcWeightPoints,
};
