const osmosis = require('osmosis')
const LRU = require('lru-cache')
const objectHash = require('object-hash')
const micro = require('micro')
const ms = require('ms')

const options = {
  max: 500
}

const cache = LRU(options)

const baseUrl = 'https://nmotw.in/'

const fetchList = () => new Promise((resolve, reject) => {
  console.log('fetchList Start')
  osmosis
    .get(baseUrl)
    .find('article')
    .set({
      name: 'h3 a',
      date: 'span.date',
      // href: 'h3 a@href',
      // tagLinks: ['.category@href'],
      tags: ['.category']
    })
    .follow('h3 a@href')
    .set({
      description: 'blockquote',
      gif: `img[src*='.gif']@src`
    })
    .error(reject)
    .data(function (data) {
      const hash = objectHash(data)
      cache.set(hash, data)
    })
    .done(function () {
      console.log('fetchList Done')
      console.log('Got', cache.length, 'items')
      return resolve()
    })
})

fetchList()
  .then(() => {
    console.log('first fetch done!')
    setInterval(fetchList, ms('10m'))
  })

const server = micro(async (req, res) => {
  if (req.url.startsWith('/images')) {
    res.statusCode = 302
    res.setHeader('Location', `${baseUrl}${req.url}`)
    res.end()
    return
  }

  if (cache.length === 0) {
    return micro.send(res, 500, 'Cache not ready.')
  }
  const acceptsJson = req.headers && req.headers['accept'] && req.headers['accept'].includes('application/json')
  const all = cache.values()

  if (acceptsJson) return all
  return JSON.stringify(all, null, 2)
})

server.listen(3000, () => console.log('http://localhost:3000'))
