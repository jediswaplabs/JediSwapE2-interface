export default function findClosestPrice(data: any) {
  const keys = ['one_day', 'two_days', 'one_week', 'one_month']
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    if (data[key] && data[key].close) {
      return data[key].close
    }
  }

  return null // Close price not found
}
