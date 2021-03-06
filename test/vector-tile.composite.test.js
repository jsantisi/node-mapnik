var mapnik = require('../');
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var mercator = new(require('sphericalmercator'));
var existsSync = require('fs').existsSync || require('path').existsSync;
var overwrite_expected_data = false;

var data_base = './test/data/vector_tile/compositing';

function render_data(name,coords,callback) {
    var map = new mapnik.Map(256, 256);
    map.loadSync(data_base +'/layers/'+name+'.xml');
    var vtile = new mapnik.VectorTile(coords[0],coords[1],coords[2]);
    var extent = mercator.bbox(coords[1],coords[2],coords[0], false, '900913');
    name = name + '-' + coords.join('-');
    map.extent = extent;
    //map.renderFileSync('./test/data/vector_tile/compositing/'+name+'.png')
    // buffer of >=5 is needed to ensure point ends up in tiles touching null island
    map.render(vtile,{buffer_size:5},function(err,vtile) {
        if (err) return callback(err);
        var tiledata = vtile.getData();
        var tilename = data_base +'/tiles/'+name+'.vector.pbf';
        fs.writeFileSync(tilename,tiledata);
        return callback();
    })
}

var tiles = [[0,0,0],
             [1,0,0],
             [1,0,1],
             [1,1,0],
             [1,1,1],
             [2,0,0],
             [2,0,1],
             [2,1,1]];

function get_data_at(name,coords) {
    return fs.readFileSync(data_base +'/tiles/'+name+'-'+coords.join('-')+'.vector.pbf');
}

function get_tile_at(name,coords) {
    var vt = new mapnik.VectorTile(coords[0],coords[1],coords[2]);
    vt.setData(get_data_at(name,coords));
    return vt
}

function compare_to_image(actual,expected_file) {
    if (!existsSync(expected_file)) {
        fs.writeFileSync(expected_file,actual);
    }
    var expected = fs.readFileSync(expected_file);
    return actual.length == expected.length;
}

describe('mapnik.VectorTile ', function() {
    // generate test data
    before(function(done) {
        if (overwrite_expected_data) {
            mapnik.register_datasource(path.join(mapnik.settings.paths.input_plugins,'csv.input'));
            var remaining = tiles.length;
            tiles.forEach(function(e){
                render_data('lines',e,function(err) {
                    if (err) throw err;
                    render_data('points',e,function(err) {
                        if (err) throw err;
                        if (--remaining < 1) {
                            done();
                        }
                    })
                })
            })
        } else {
            done();
        }
    });

    it('should render with simple concatenation', function(done) {
        var coords = [0,0,0];
        var vtile = new mapnik.VectorTile(coords[0],coords[1],coords[2]);
        var vtiles = [get_tile_at('lines',coords),get_tile_at('points',coords)]
        var expected_length = get_data_at('lines',coords).length + get_data_at('points',coords).length;
        // alternative method of getting combined length
        var expected_length2 = Buffer.concat([vtiles[0].getData(),vtiles[1].getData()]).length;
        // Let's confirm they match
        assert.equal(expected_length,expected_length2);
        // Now composite the tiles together
        var opts = {}; // NOTE: options here will have no impact in the case of concatenation
        vtile.composite(vtiles,opts);
        // It is safe to call vt.getData after vt.composite without calling vt.parse
        var composited_data = vtile.getData();
        assert.equal(composited_data.length,expected_length);
        // It is also safe to call vtile.names() without vt.parse because vt.names() can
        // operate on the raw protobuf data and does not need parsed data
        // In the future other functions will gain this ability.
        assert.deepEqual(vtile.names(),['lines','points']);
        // Now we parse in order to be able to test rendering
        vtile.parse(function(err) {
            if (err) throw err;
            // ensure the lengths still match
            assert.equal(vtile.getData().length,expected_length);
            var map = new mapnik.Map(256,256);
            map.loadSync(data_base +'/styles/all.xml');
            vtile.render(map,new mapnik.Image(256,256),function(err,im) {
                if (err) throw err;
                var actual = im.encodeSync('png32');
                var expected_file = data_base +'/expected/concat.png';
                assert.ok(compare_to_image(actual,expected_file));
                done();
            })
        })
    });

    it('should render by overzooming', function(done) {
        var vtile = new mapnik.VectorTile(2,1,1);
        var vtiles = [get_tile_at('lines',[0,0,0]),get_tile_at('points',[1,1,1])]
        // raw length of input buffers
        var original_length = Buffer.concat([vtiles[0].getData(),vtiles[1].getData()]).length;
        vtile.composite(vtiles);
        var new_length = vtile.getData().length;
        // re-rendered data should be different length
        assert.notEqual(new_length,original_length);
        assert.deepEqual(vtile.names(),['lines','points']);
        vtile.parse(function(err) {
            if (err) throw err;
            // length should be the same before and after parse
            assert.equal(new_length,vtile.getData().length);
            var json_result = vtile.toJSON();
            assert.equal(json_result.length,2);
            assert.equal(json_result[0].features.length,2);
            assert.equal(json_result[1].features.length,1);
            // tile is actually bigger because of how geometries are encoded
            assert.ok(vtile.getData().length > Buffer.concat([vtiles[0].getData(),vtiles[1].getData()]).length)
            var map = new mapnik.Map(256,256);
            map.loadSync(data_base +'/styles/all.xml');
            vtile.render(map,new mapnik.Image(256,256),{buffer_size:256},function(err,im) {
                if (err) throw err;
                var actual = im.encodeSync('png32');
                var expected_file = data_base +'/expected/2-1-1.png';
                assert.ok(compare_to_image(actual,expected_file));
                done();
            })
        })
    });

    it('should render with custom buffer_size', function(done) {
        var vtile = new mapnik.VectorTile(2,1,1);
        var vtiles = [get_tile_at('lines',[0,0,0]),get_tile_at('points',[1,1,1])]
        var opts = {buffer_size:-256}; // will lead to dropped data
        vtile.composite(vtiles,opts);
        assert.deepEqual(vtile.names(),[]);
        vtile.parse(function(err) {
            assert.ok(err);
            assert.equal(err.message,'cannot parse 0 length buffer as protobuf');
            // now continue rendering empty tile
            var json_result = vtile.toJSON();
            assert.equal(json_result.length,0);
            var map = new mapnik.Map(256,256);
            map.loadSync(data_base +'/styles/all.xml');
            vtile.render(map,new mapnik.Image(256,256),{buffer_size:256},function(err,im) {
                if (err) throw err;
                var actual = im.encodeSync('png32');
                var expected_file = data_base +'/expected/2-1-1-empty.png';
                assert.ok(compare_to_image(actual,expected_file));
                done();
            })
        })
    });

    it('should render by overzooming (drops point)', function(done) {
        var vtile = new mapnik.VectorTile(2,1,1);
        var vtiles = [get_tile_at('lines',[2,1,1]),get_tile_at('points',[2,0,1])]
        vtile.composite(vtiles);
        assert.deepEqual(vtile.names(),["lines"]);
        vtile.parse(function(err) {
            if (err) throw err;
            var json_result = vtile.toJSON();
            assert.equal(json_result.length,1);
            assert.equal(json_result[0].features.length,2);
            var map = new mapnik.Map(256,256);
            map.loadSync(data_base +'/styles/all.xml');
            vtile.render(map,new mapnik.Image(256,256),{buffer_size:256},function(err,im) {
                if (err) throw err;
                var actual = im.encodeSync('png32');
                var expected_file = data_base +'/expected/2-1-1-no-point.png';
                assert.ok(compare_to_image(actual,expected_file));
                done();
            })
        })
    });

    // NOTE: this is a unintended usecase, but it can be done, so let's test it
    it('should render by underzooming or mosaicing', function(done) {
        var vtile = new mapnik.VectorTile(0,0,0);
        var vtiles = [];
        tiles.forEach(function(coords) {
            if (coords[0] == 1) {
                vtiles.push(get_tile_at('lines',[coords[0],coords[1],coords[2]]));
                vtiles.push(get_tile_at('points',[coords[0],coords[1],coords[2]]));
            }
        });
        vtile.composite(vtiles);
        assert.deepEqual(vtile.names(),["lines","points","lines","points","lines","points","lines","points"]);
        vtile.parse(function(err) {
            if (err) throw err;
            var json_result = vtile.toJSON();
            assert.equal(json_result.length,8);
            assert.equal(json_result[0].features.length,2);
            assert.equal(json_result[1].features.length,1);
            // tile is actually bigger because of how geometries are encoded
            assert.ok(vtile.getData().length > Buffer.concat([vtiles[0].getData(),vtiles[1].getData()]).length)
            var map = new mapnik.Map(256,256);
            map.loadSync(data_base +'/styles/all.xml');
            vtile.render(map,new mapnik.Image(256,256),{buffer_size:256},function(err,im) {
                if (err) throw err;
                var actual = im.encodeSync('png32');
                var expected_file = data_base +'/expected/0-0-0-mosaic.png';
                assert.ok(compare_to_image(actual,expected_file));
                done();
            })
        })
    });

});
