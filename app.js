//REQUIRES
var express = require("express"),
  app = express(),
  request = require('request'),
  methodOverride = require('method-override'),
  bodyParser = require("body-parser"),
  passport = require("passport"),
  passportLocal = require("passport-local"),
  cookieParser = require("cookie-parser"),
  session = require("cookie-session"),
  db = require("./models/index"),
  flash = require("connect-flash"),
  morgan = require('morgan'),
  async = require('async'),
  routeMiddleware = require('./config/routes');

//MIDDLEWARE
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({extended:true}));
app.use(methodOverride('_method'));

//Middleware for ejs, grabbing HTML and including static files
app.use(morgan('dev'));

app.use(session({
  secret: 'supersecretkey',
  name:'chocolate',
  //this is in milliseconds
  maxage: 10000000
  })//close session
);//close app.use

//my passport initiators
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

//pushes isAuthenticated and user to every page
app.use(function(req,res,next){
  res.locals = {isAuthenticated: req.isAuthenticated(), user: req.user};
  next();
});

//prepare our serialize functions
passport.serializeUser(function(user, done){
  console.log("SERIALIZED JUST RAN!");
  done(null, user.id);
});
passport.deserializeUser(function(id, done){
  console.log("DESERIALIZED JUST RAN!");
  db.User.find({
      where: {
        id: id
      }
    })
    .done(function(error, user){
      done(error, user);
    });
});


//GLOBAL FUNCTIONS

var fetchFromGuardian = function(searchTerm, success, error){
  var guardianUrl = "http://content.guardianapis.com/search?api-key=" + process.env.GUARDIAN_API + "&order-by=newest&q=" + searchTerm;
  var articleList = [];
  request(guardianUrl, function(error, response, body){
    console.log("GUARDIAN SEARCH code:" + response.statusCode);
        if (!error && response.statusCode == 200){
                var guardianResult = (JSON.parse(body)).response.results;
                guardianResult.forEach(function(article){
                  var articleTemp = {};
                  articleTemp.title = article.webTitle;
                  articleTemp.url = article.webUrl;
                  articleTemp.date = article.webPublicationDate;
                  articleTemp.source = "The Guardian";
                  articleTemp.twitter = "@guardian";
                  console.log("guardian article for " + searchTerm);
                  articleList.push(articleTemp);
                });
      console.log("articleList length:" + articleList.length);
      console.log("guardianResult length:" + guardianResult.length);
      console.log("articleList" + articleList);
      console.log("GUARDIAN SUCCESS");
      success(articleList);
    } else {
      console.log("ERROR WITH GUARDIAN", error);
      success([]);
    }
  });//first request(the guardian)
};

var fetchFromNYT = function(searchTerm, success, error) {
  var nytimesUrl = "http://api.nytimes.com/svc/search/v2/articlesearch.json?q=" + searchTerm + "&api-key=" + process.env.NYT_API;
  var articleList = [];
  request(nytimesUrl, function(error, response, body){
    console.log("NYTIMES SEARCH code:" + response.statusCode);

    if (!error && response.statusCode === 200){
      var nytimesResult = JSON.parse(body).response.docs;
      nytimesResult.forEach(function(article){
              var articleTemp = {};
              articleTemp.title = article.headline.main;
              articleTemp.url = article.web_url;
              articleTemp.date = article.pub_date;
              articleTemp.summary = article.snippet;
              articleTemp.source = article.source;
              articleTemp.twitter = "@nytimes";
              console.log("nytimes article for " + searchTerm);
              articleList.push(articleTemp);
            });
      console.log("articleList length:" + articleList.length);
      console.log("nytimesResult length:" + nytimesResult.length);
      console.log("articleList" + articleList);
      console.log("NYTIMES SUCCESS");

      //SORT articleList
      success(articleList);
    } else {
      console.log("ERROR WITH NYTIMES", error);
      success([]);
    }
  });// request (the new york times)
};

var fetchKeyword = function (keyword, callback) {
  var searchTerm = keyword.name;
  var results = {keyword:searchTerm};
  //call THE GUARDIAN API searching for search query-related articles
  fetchFromGuardian(searchTerm, function(guardianArticles){
    //call The NY TIMES API searching for search query-related articles
    results.guardian = guardianArticles;
    fetchFromNYT(searchTerm, function(nytArticles){
      results.nyt = nytArticles;
      callback(null, results);
    }, function(){
      console.log("NYT Error");
      callback("NYT Error", []);
    });//NYT
  }, function(){
    //if fetchFromGuardian error
      console.log("Guardian Error");
      callback("Guardian Error", []);
  });//Guardian
};

/////////ROUTES AND FUNCTIONS//////////

//Home
app.get('/', function(req, res){

  if(req.user){
    db.User.find(req.user.id).done(function(err,user){
    user.getKeywords().done(function(err,keywords){
      res.render('home',{keywords:keywords});
    });
  });
  }
  else{
    res.render('home');
  }
});

app.get('/home', function(req, res){

  if(req.user){
    db.User.find(req.user.id).done(function(err,user){
    user.getKeywords().done(function(err,keywords){
      res.render('home',{keywords:keywords});
    });
  });
  }
  else{
    res.render('home');
  }
});

//CREATE KEYWORD on SEARCH
app.get('/search', function(req, res){

if (req.user){
  var keyword = req.query.keyword;
  console.log("Keyword:" + keyword);
  db.Keyword.findOrCreate({
    where: {
      name: keyword
    }
  }).done(function(err, keyword, created){
    console.log("Created Keyword ERR:" + err);
    console.log("Created Keyword:" + keyword);
    db.KeywordsUser.findOrCreate({
      where: {
        UserId: req.user.id,
        KeywordId: keyword.id
      }
    }).done(function(err, result){
      req.user.getKeywords().done(function(err, keywords){
        async.map(keywords, fetchKeyword, function(err, results){

          res.render("results", { articleList: results, user: req.user, keywordList: keywords});
        });
      });
    });
  });
} else {

      //assign new keyword to searchTerm
      var searchTerm = {name:req.query.keyword};
      //Declare variables for Search Results from APIs
      var articleList = [];


      fetchKeyword(searchTerm, function(err, results){
        res.render("results", { articleList: [results]});
      });

  }//close else
});//close App



////////SIGN UP AND LOGIN////////
//Signup
app.get('/signup', routeMiddleware.preventLoginSignup, function(req,res){
    res.render('signup', { username: ""});
});

//on submit, create a new users using form values
app.post('/submit', function(req,res){

  db.User.createNewUser(req.body.username, req.body.password,
    req.body.email, req.body.twitter,
  function(err){
    res.render("home", {message: err.message, username: req.body.username});
  },
  function(success){
    res.render("home", {message: success.message});
  });
});

//Login
app.get('/login', routeMiddleware.preventLoginSignup, function(req,res){
  res.render('login', {message: req.flash('loginMessage'), username:""});
});

// authenticate users when logging in - no need for req,res passport does this for us
app.post('/login', passport.authenticate('local', {
  successRedirect: '/home',
  failureRedirect: '/login',
  failureFlash: true
}));

app.get('/logout', function(req,res){
  //req.logout added by passport - delete the user id/session
  req.logout();
  res.redirect('/');
});

//////////////KEYWORD ROUTES/////////////
//


//DELETE
// app.get('/keyword/:id', function(req,res){
//   var keywordId = req.params.id;

//   db.Keyword.findAll({
//     where: {
//       id: keywordId
//     }
//   }).done(function(err, keyword, created){
//     db.KeywordsUser.create({
//       UserId: req.user.id,
//       KeywordId: keyword.id
//     }).done(function(err,result){
//       res.render('')
//     })
//   });


//404
// app.get('*', function(req, res){
//   res.render('404');
// });


//3000
app.listen(3000, function(){
  "Server is listening on port 3000";
});