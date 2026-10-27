const choices = ['5', '10', '12', '15', '20', '23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '72', '75', '90', '100', '120'];
const fractional = { '23.976': '24000/1001', '29.97': '30000/1001', '59.94': '60000/1001' };

function getFrameRate(value) {
  if (value === 'source') return null;
  if (!['string', 'number'].includes(typeof value)) throw new Error('フレームレートが不正です。');
  const key = String(value);
  const selected = choices.find(item => item === key || fractional[item] === key);
  if (!selected) throw new Error('フレームレートが不正です。');
  const filter = fractional[selected] || selected;
  const [numerator, denominator = '1'] = filter.split('/');
  return { value: selected, filter, fps: Number(numerator) / Number(denominator) };
}

module.exports = { choices, getFrameRate };
