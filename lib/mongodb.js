var sys   = require("sys");
var mongo = require("../lib/mongo");
var crypto = require("crypto");

function Collection(mongo, db, name) {
    this.mongo = mongo;
    this.ns = db + "." + name;
    this.db = db;
    this.name = name;
}

Collection.prototype.getLastError = function(callback)
{
    ns = this.db + ".$cmd";
    var cmd = {
        "query": {getlasterror: 1}
    };

    this.find_one(cmd, {}, ns, function (result) {
        callback(result);
    });

};

Collection.prototype.find = function(query, fields, callback, limit, skip, sort) {
    var cmd = {
        "$query" : query ? query : {}
    };

    if(sort) 
        cmd.$orderby = sort;
    this.mongo.addQuery(callback, this.ns, cmd, fields, limit, skip);
};

Collection.prototype.insert = function(obj) {
    this.mongo.connection.insert(this.ns, obj);
};

Collection.prototype.update = function(cond, obj, options) {
    var db_upsert = 0;
    var db_multi_update = 0;
    db_upsert = options != null && options['upsert'] != null ? (options['upsert'] == true ? 1 : 0) : db_upsert;
    db_multi_update = options != null && options['multi'] != null ? (options['multi'] == true ? 1 : 0) : db_multi_update;
    flags = parseInt(db_multi_update.toString() + db_upsert.toString(), 2);
    this.mongo.connection.update(this.ns, cond, obj, flags);
};

Collection.prototype.remove = function(query) {
    this.mongo.connection.remove(this.ns, query);
};

Collection.prototype.find_one = function(query, fields, ns, callback) {
    this.mongo.addQuery(function (results) {
        // XXX what if result.Length < 1
        callback(results[0]);
    }, ns || this.ns, query, fields, 1);
};

Collection.prototype.count = function(query, callback) {
    ns = this.db + ".$cmd";
    var cmd = {
        "count": this.name,
        "query": query
    };

    this.find_one(cmd, {}, ns, function (result) {
        callback(result.n);
    });
};

function MongoDB() {
    this.myID = Math.random();
    this.connection = new mongo.Connection();

    var self = this;

    this.connection.addListener("close", function () {
        self.isReady = false;
        self.emit("close");
    });

    this.connection.addListener("drained", function() {
        self.emit("drained");
    });

    this.connection.addListener("ready", function () {
        self.isReady = true;
        self.dispatch();
    });

    this.connection.addListener("connection", function () {
        if(self.username) // if we see a username, authenticate
        {
            var ns = self.db + ".$cmd";
            var cmd = {
                "query": { getnonce: 1}
            };

            self.addQuery(function (results) 
                          {
                              var nonce = results[0].nonce;
                              var authcmd = {};
                              authcmd.authenticate = 1;
                              authcmd.user = self.username;
                              authcmd.nonce = nonce;
                              
                              var hash = crypto.createHash('md5');
                              hash.update(self.username + ":mongo:" + self.password);
                              var pwd = hash.digest('hex');

                              var hash = crypto.createHash('md5');
                              hash.update(nonce + self.username + pwd);
                              authcmd.key = hash.digest('hex');
                              
                              var ns = self.db + ".$cmd";
                              var cmd = {
                                  "query": authcmd
                              };
                              self.addQuery(function(results)
                                            {
                                                if(results[0].ok == 1)
                                                    {
                                                        self.isReady = true;
                                                        self.emit("connection", self);
                                                    }
                                                else
                                                    sys.puts("authentication error!");
                                            }, ns, cmd, {}, 1);
                              self.dispatch();
                          }, ns, cmd, {}, 1);
            self.dispatch();
            return;
        }
        self.dispatch();
        self.emit("connection", self);
    });

    this.connection.addListener("result", function(result) {
        var callback = self.currentQuery[0];
        self.currentQuery = null;
        callback(result);
        self.dispatch();
    });
}

sys.inherits(MongoDB, process.EventEmitter);

MongoDB.prototype.connect = function(args) {
    this.queries = [];
    this.hostname = args.hostname || "127.0.0.1";
    this.port = args.port || 27017;
    this.db = args.db;
    this.username = args.username;
    this.password = args.password;
    this.connection.connect(this.hostname, this.port);
};

MongoDB.prototype.close = function() {
    this.connection.close();
};

MongoDB.prototype.addQuery = function(callback, ns, query, fields, limit, skip ) {
    var q = [ callback, ns ];
    if (query) q.push(query); else q.push({});
    if (fields) q.push(fields); else q.push({});
    if (limit) q.push(limit); else q.push(0);
    if (skip) q.push(skip); else q.push(0);
    this.queries.push(q);
    if(this.isReady)
        this.dispatch();
};

MongoDB.prototype.dispatch = function() {
    if (this.currentQuery || !this.queries.length) return;
    this.currentQuery = this.queries.shift();
    this.connection.find.apply(this.connection, this.currentQuery.slice(1));
};

MongoDB.prototype.getCollection = function(name) {
    return new Collection(this, this.db, name);
};

MongoDB.prototype.getCollections = function(callback) {
    this.addQuery(function (results) {
        var collections = [];
        results.forEach(function (r) {
            if (r.name.indexOf("$") != -1)
                return;
            collections.push(r.name.slice(r.name.indexOf(".")+1));
        });
		callback(collections);
	}, this.db + ".system.namespaces");

};

exports.MongoDB = MongoDB;
exports.ObjectID = mongo.ObjectID;
