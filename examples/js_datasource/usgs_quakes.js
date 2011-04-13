#!/usr/bin/env node

// Example of streaming feature showing last 30 days of global earthquakes 
// from the USGS earthquake data feed
// 
// dependencies:
// 
// * node-mapnik
// * node-get

/*
NOTE - maps using mapnik.JSDatasource can only be rendered with
mapnik.render_to_string() or mapnik.render_to_file() as the javascript
callback only works if the rendering happens in the main thread.

If you want async rendering using mapnik.render() then use the
mapnik.MemoryDatasource instead of mapnik.JSDatasource.
*/

var mapnik = require('mapnik');
var sys = require('fs');
var path = require('path');
var get = require('node-get');
var merc = '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +no_defs +over';

// map with just a style
// eventually the api will support adding styles in javascript
var s = '<Map srs="' + merc + '">';
s += '<Style name="points">';
s += ' <Rule>';
s += '  <Filter>[MAGNITUDE]&gt;7</Filter>';
s += '  <MarkersSymbolizer marker-type="ellipse" fill="red" width="15" allow-overlap="true" placement="point"/>';
s += ' </Rule>';
s += ' <Rule>';
s += '  <Filter>[MAGNITUDE]&gt;4</Filter>';
s += '  <MarkersSymbolizer marker-type="ellipse" fill="orange" width="7" opacity="0.5" allow-overlap="true" placement="point"/>';
s += ' </Rule>';
s += ' <Rule>';
s += '  <ElseFilter />';
s += '  <MarkersSymbolizer marker-type="ellipse" fill="yellow" width="3" opacity="0.5" allow-overlap="true" placement="point"/>';
s += ' </Rule>';
s += '</Style>';
s += '</Map>';

// create map object with base map
var map  = new mapnik.Map(800,600);
var merc = new mapnik.Projection('+init=epsg:3857');
map.load(path.join(__dirname, '../stylesheet.xml'));
map.from_string(s,'.');

// Latest 30 days of earthquakes > 2.5 from USGS (http://earthquake.usgs.gov/earthquakes/catalogs/) 
// CSV munged into json using Yahoo pipes
var dl = new get("http://pipes.yahoo.com/pipes/pipe.run?_id=f36216d2581df7ed23615f42ff2af187&_render=json")
dl.asString(function(err,str){
  // Loop through quake list
  // WARNING - this API will change!
  var quakes = JSON.parse(str).value.items;
  var quake;
  var next = function() {
      while (quake = quakes.pop()) {
        var merc_coords = merc.forward([+quake.Lon, +quake.Lat]); //reproject wgs84 to mercator
        return { 'x'          : merc_coords[0],
                 'y'          : merc_coords[1],
                 'properties' : { 'NAME':quake.Region,'MAGNITUDE':+quake.Magnitude}
               };
      }
  }

  // create the Merc special datasource
  var options = {
    extent: '-20037508.342789,-8283343.693883,20037508.342789,18365151.363070',
  };
  var ds = new mapnik.JSDatasource(options,next);

  // contruct a mapnik layer dynamically
  var l = new mapnik.Layer('test');
  l.srs = map.srs;
  l.styles = ["points"];

  // add our custom datasource
  l.datasource = ds;

  // add this layer to the map
  map.add_layer(l);

  // zoom to the extent of the new layer (pulled from options since otherwise we cannot know)
  map.zoom_all();

  // render it! You should see a bunch of red and blue points reprenting
  map.render_to_file('quakes.png');

  console.log('rendered to quakes.png' );
});