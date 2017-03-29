const osmosis = require('osmosis')
const micro = require('micro')
const ms = require('ms')
const pMemoize = require('p-memoize')
const moment = require('moment')
const bodyParser = require('urlencoded-body-parser')
const fetch = require('isomorphic-fetch')
const queryString = require('querystring')

const baseUrl = 'https://nmotw.in/'

const fetchModules = () => new Promise((resolve, reject) => {
  console.log('fetchList Start')
  const modules = []

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
    .data(function (raw) {
      const module = Object.assign({}, raw, {
        date: moment(raw.date, 'YYYY MMM D').format('YYYY-MM-DD'),
        tags: (raw.tags || []).map(tag => tag.toLowerCase())
      })
      modules.push(module)
    })
    .done(function () {
      console.log('fetchList Done')
      console.log('Got', modules.length, 'items')
      const sortedModules = modules.sort((lhs, rhs) => {
        const lhsDate = moment(lhs.date, 'YYYY-MM-DD')
        const rhsDate = moment(rhs.date, 'YYYY-MM-DD')

        if (lhsDate.isBefore(rhsDate)) return 1
        if (rhsDate.isBefore(lhsDate)) return -1
        return 0
      })
      return resolve(sortedModules)
    })
})

const getLatest = modules => modules.reduce((latest, current) => {
  if (!latest) return current
  if (moment(current.date).isAfter(latest.date)) return current
  return latest
})

const getModules = pMemoize(fetchModules, { maxAge: ms('10m') })

getModules() // init cache

const humanJson = (req, data) => {
  const acceptsJson = req.headers && req.headers['accept'] && req.headers['accept'].includes('application/json')
  if (acceptsJson) return data
  return JSON.stringify(data, null, 2)
}

const server = micro(async (req, res) => {
  const isSlack = req.method === 'POST' && req.url.startsWith('/slack')

  if (req.url.startsWith('/slack/oauth')) {
    return `
<meta charset="utf-8" />
<style>body, html { font-family: sans-serif; }</style>
Done! type <b>/nmotw</b> in any channel to get the module of the week 🎉
    `
  }
  if (req.url === '/slack' && !isSlack) {
    res.setHeader('Content-Type', 'text/html')
    const query = queryString.stringify({
      client_id: '4719412218.159200113984',
      scope: 'commands',
      state: 'done',
      redirect_uri: `https://nmotw-api.now.sh/slack/oauth`
    })
    const redirect = `https://slack.com/oauth/authorize?${query}`
    return `
<style>body, html { font-family: sans-serif; }</style>
<meta charset="utf-8" />
<div>
  <h3>📦 Node module of the week slash command (/nmotw)</h3>
  <a href='${redirect}'>💬 Add to slack</a>
  <a href='https://github.com/albinekb/nmotw-api'>📦 Github</a>
</div>
    `
  }

  if (req.url.startsWith('/images')) {
    res.statusCode = 302
    res.setHeader('Location', `${baseUrl}${req.url}`)
    res.end()
    return
  }

  const modules = await getModules()

  if (modules.length === 0) {
    return micro.send(res, 500, 'Cache not ready.')
  }

  if (isSlack) {
    const { response_url: responseUrl } = await bodyParser(req)
    const module = await getLatest(modules)
    console.log(responseUrl)

    const message = {
      response_type: 'in_channel',
      attachments: [{
        fallback: module.name,
        color: '#36a64f',
        author_name: `Module of the week (${moment(module.date, 'YYYY-MM-DD').format('W')})`,
        title: module.name,
        text: module.description,
        title_link: `https://npmjs.org/package/${module.name}`,
        image_url: `${process.env.NOW_URL}${module.gif}`,
        footer: `https://npmjs.org/package/${module.name}`
      }]
    }

    setTimeout(() => {
      fetch(responseUrl, {
        method: 'post',
        headers: {
          'Content-type': 'application/json'
        },
        body: JSON.stringify(message)
      })
    }, 5000)

    return 'Loading!'
    // return `Module of the week is **${latest.name}** (${latest.tags.join(', ')})\n${latest.description}\nhttps://npmjs.org/package/${latest.name}`
  }

  if (req.url.startsWith('/latest')) {
    const latest = getLatest(modules)

    return humanJson(req, latest)
  }

  if (req.url.startsWith('/tags')) {
    const allTags = modules
      .map(module => module.tags)
      .filter(Boolean)
      .reduce((all, current) => {
        return [...all, ...current]
      }, [])

    const uniqueTags = new Set(allTags)

    const tags = [...uniqueTags]

    return humanJson(req, tags)
  }

  if (req.url.startsWith('/tag/')) {
    const paths = req.url.split('/')
    const tag = paths[paths.length - 1]

    const results = modules
      .filter(module => module.tags && module.tags.includes(tag))

    if (results.length === 0) {
      return micro.send(res, 404, `No modules with tag "${tag}" found.`)
    }

    return humanJson(req, results)
  }

  return humanJson(req, modules)
})

server.listen(3000, () => console.log('http://localhost:3000'))
