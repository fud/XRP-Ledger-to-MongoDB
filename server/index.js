const fileSystem = require('fs')
const JSONStream = require('JSONStream')
const WebSocket = require('ws')
const ws = new WebSocket('ws://127.0.0.1')
const MongoClient = require('mongodb').MongoClient
const express = require('express')
const decimals = 1000000
const max_processing_seconds = 5

var allowCrossDomain = function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    next()
}

var app = express()
var bodyParser = require('body-parser')
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())
app.use(allowCrossDomain)

var port = process.env.PORT || 4000

var db = null
var mongo = null
var collection = null

var router = express.Router()
router.get('/', function(req, res) {
  res.json({ message: 'Hooray! welcome to our API!' })
})

app.use('/api', router)

router.route('/escrowlist').get(function(req, res) {
  db.collection('escrow').find({}).project({
    _id: false,
    Account: true,
    Amount: true,
    Destination: true,
    DestinationTag: true,
    FinishAfter: true,
    CancelAfter: true,
    Condition: true
  }).toArray((err, data) => {
    res.json(data)
  })
})

router.route('/wallet-toplist/:amount?/:skip?').get(function(req, res) {
  var amount = 0
  var skip = 0

  if (typeof req.params.amount !== 'undefined' && req.params.amount && req.params.amount !== null) {
    amount = parseInt(req.params.amount)
    if (isNaN(amount) || amount > 999 || amount < 1) {
      amount = 10
    }
  }

  if (typeof req.params.skip !== 'undefined' && req.params.skip && req.params.skip !== null) {
    skip = parseInt(req.params.skip)
    if (isNaN(skip) || skip > 999) {
      skip = 0
    }
  }

  collection.find({}).sort({
    Balance: -1
  }).project({
    _id: false,
    Balance: true,
    Account: true
  }).skip(skip).limit(amount).toArray((err, data) => {
    res.json(data)
  })
})

router.route('/richlist').get(function(req, res) {
  var responseSent = false
  var requested = 0
  var responded = 0
  var response = {
    error: false,
    message: '',
    accounts: 0,
    datamoment: '',
    has: {
      has1000000000: null,
      has500000000: null,
      has100000000: null,
      has20000000: null,
      has10000000: null,
      has5000000: null,
      has1000000: null,
      has500000: null,
      has100000: null,
      has50000: null,
      has10000: null,
      has5000: null,
      has1000: null,
      has500: null,
      has0: null
    },
    pct: {
      pct0p2: null,
      pct0p5: null,
      pct1: null,
      pct2: null,
      pct3: null,
      pct4: null,
      pct5: null,
      pct10: null
    }
  }
  var responseTimeout = setTimeout(() => {
    clearTimeout(responseTimeout)
    response.error = true
    response.message = 'Timeout'
    res.json(response)
  }, max_processing_seconds * 1000 * 5)

  var sendResponse = function () {
    if (!responseSent && requested === responded) {
      clearTimeout(responseTimeout)
      res.json(response)
    }
  }

  requested++
  collection.count({}, function(error, numOfDocs) {
    responded++
    response.accounts = numOfDocs

    Object.keys(response.pct).forEach((f) => {
        if (f.match(/^pct[0-9p]+$/)) {
          var amount = parseFloat(f.substring(3).replace(/p/,'.'))
          var amountpct = Math.ceil(numOfDocs / 100 * amount)
          requested++
          collection.aggregate([
            { $sort: { Balance: -1 } },
            { $limit: amountpct },
            { $group: {
              _id: 1,
              minBalance: { $min: '$Balance' },
              minLastUpdate: { $max: '$__lastUpdate' }
            } }
          ]).toArray(function(error, d) {
            response.datamoment = d[0].minLastUpdate
            responded++
            response.pct[f] = d[0].minBalance
            sendResponse()
          })
          lastMax = amount
        }
      })
  })
  var lastMax = null
  Object.keys(response.has).forEach((f) => {
    if (f.match(/^has[0-9]+$/)) {
      var amount = parseInt(f.substring(3))
      var query = {
        Balance: { $gte: amount }
      }
      if (lastMax !== null) {
        query.Balance.$lt = lastMax
      }
      requested++
      collection.aggregate([
        { $match: query },
        { $group: {
          _id: 1,
          count: { $sum : 1 },
          balanceSum: { $sum : '$Balance' }
        } }
      ]).toArray(function(error, d) {
        responded++
        response.has[f] = {
          accounts: d[0].count,
          balanceSum: d[0].balanceSum,
        }
        sendResponse()
      })
      lastMax = amount
    }
  })
})

router.route('/richlist-index/:account/:ignoregt?').get(function(req, res) {
  var responseSent = false
  var response = {
    error: false,
    query: req.params.account,
    sum: 0,
    accounts: [],
    numAccounts: 0,
    lt: {
      count: null,
      percentage: 0
    },
    eq: {
      count: null,
      percentage: 0
    },
    gt: {
      count: null,
      percentage: 0
    }
  }

  var responseTimeout = setTimeout(() => {
    res.json({ error: true, message: 'Timeout' })
  }, max_processing_seconds * 1000)

  var countQuery = {}
  // if (req.params.ignoregt !== null && typeof req.params.ignoregt !== 'undefined' && req.params.ignoregt.match(/^[0-9]+$/)) {
  //   var ignoreGt = parseInt(req.params.ignoregt)
  //   countQuery.Balance = { $lt: ignoreGt }
  // }
  // console.log(countQuery)
  collection.count(countQuery, function(error, numOfDocs) {
    response.numAccounts = numOfDocs
    collection.find({ Account: { $in: req.params.account.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ') } }).project({
      Account: true,
      Balance: true,
      __lastUpdate: true,
      Sequence: true
    }).toArray(function (e, d) {
      if (req.params.account.trim().match(/^[0-9]+$/)) {
        response.sum = parseInt(req.params.account)
      }
      if (e) {
        clearTimeout(responseTimeout)
        res.json({ error: true, message: 'Error', details: e })
      } else {
        if (d.length < 1 && response.sum === 0) {
          clearTimeout(responseTimeout)
          res.json({ error: true, message: 'Cannot find account' })
        } else {
          response.accounts = d
          var sendResponse = function () {
            if (!responseSent && response.lt.count !== null && response.gt.count !== null && response.eq.count !== null) {
              clearTimeout(responseTimeout)
              response.lt.percentage = Math.ceil(response.lt.count / response.numAccounts * decimals) / decimals
              response.gt.percentage = Math.ceil(response.gt.count / response.numAccounts * decimals) / decimals
              response.eq.percentage = Math.ceil(response.eq.count / response.numAccounts * decimals) / decimals
              res.json(response)
              responseSent = true
            }
          }
          if (response.sum === 0) {
            response.sum = response.accounts.map((a) => {
              return a.Balance
            }).reduce((a, b) => {
              return a + b
            }, 0)
          }
          collection.find({ Balance: { $lt : response.sum } }).project({ _id: false, Balance: true }).sort({ Balance: -1 }).count(false, function(e, c) {
            response.lt.count = c
            sendResponse()
          })
          collection.find({ Balance: { $eq : response.sum } }).project({ _id: false, Balance: true }).sort({ Balance: -1 }).count(false, function(e, c) {
            response.eq.count = c
            sendResponse()
          })
          collection.find({ Balance: { $gt : response.sum } }).project({ _id: false, Balance: true }).sort({ Balance: -1 }).count(false, function(e, c) {
            response.gt.count = c
            sendResponse()
          })
        }
      }
    })
  })
})

MongoClient.connect('mongodb://127.0.0.1:27017', function(err, client) {
  mongo = client
  console.log('Connected to MongoDB');
  db = client.db('ripple')
  collection = db.collection('account')

  app.listen(port)
  console.log('API magic happens on port', port)
})

