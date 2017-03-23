import express             from 'express';
import BodyParser          from 'body-parser';
import * as Middlewares    from '../middlewares';
import Parse               from 'parse/node';
import Config              from '../Config';
import mime                from 'mime';
import logger              from '../logger';

export class FilesRouter {

  expressRouter(options = {}) {
    var router = express.Router();
    router.get('/files/:appId/:filename', this.getHandler);

    router.post('/files', function(req, res, next) {
      next(new Parse.Error(Parse.Error.INVALID_FILE_NAME,
        'Filename not provided.'));
    });

    router.post('/files/:filename',
      Middlewares.allowCrossDomain,
      BodyParser.raw({type: () => { return true; }, limit: options.maxUploadSize || '20mb'}), // Allow uploads without Content-Type, or with any Content-Type.
      Middlewares.handleParseHeaders,
      this.createHandler
    );

    router.post('/wxfiles/:filename',
      Middlewares.allowCrossDomain,
      BodyParser.raw({type: () => { return true; }, limit: options.maxUploadSize || '20mb'}), // Allow uploads without Content-Type, or with any Content-Type.
      Middlewares.handleParseHeaders,
      this.wxcreateHandler
    );

    router.delete('/files/:filename',
      Middlewares.allowCrossDomain,
      Middlewares.handleParseHeaders,
      Middlewares.enforceMasterKeyAccess,
      this.deleteHandler
    );
    return router;
  }

  getHandler(req, res) {
    const config = new Config(req.params.appId);
    const filesController = config.filesController;
    const filename = req.params.filename;
    const contentType = mime.lookup(filename);
    if (isFileStreamable(req, filesController)) {
      filesController.getFileStream(config, filename).then((stream) => {
        handleFileStream(stream, req, res, contentType);
      }).catch(() => {
        res.status(404);
        res.set('Content-Type', 'text/plain');
        res.end('File not found.');
      });
    } else {
      filesController.getFileData(config, filename).then((data) => {
        res.status(200);
        res.set('Content-Type', contentType);
        res.set('Content-Length', data.length);
        res.end(data);
      }).catch(() => {
        res.status(404);
        res.set('Content-Type', 'text/plain');
        res.end('File not found.');
      });
    }
  }

  wxcreateHandler(req, res, next) {
    if (!req.body || !req.body.length) {
      next(new Parse.Error(Parse.Error.FILE_SAVE_ERROR,
        'Invalid file upload.'));
      return;
    }

    if (req.params.filename.length > 128) {
      next(new Parse.Error(Parse.Error.INVALID_FILE_NAME,
        'Filename too long.'));
      return;
    }

    if (!req.params.filename.match(/^[_a-zA-Z0-9][a-zA-Z0-9@\.\ ~_-]*$/)) {
      next(new Parse.Error(Parse.Error.INVALID_FILE_NAME,
        'Filename contains invalid characters.'));
      return;
    }

    const filename = req.params.filename;
    const contentType = req.get('Content-type');
    const config = req.config;
    const filesController = config.filesController;

    var mulitiParts = MultiPart_parse(req.body, contentType);
    //console.log('shang:wxcreateHandler:mulitiParts[filename]:' + mulitiParts[filename]);

    // on WX real cell phone, sometimes file name is fixed as: 'wx-file.jpg'
    var data = mulitiParts['wx-file.jpg'] || mulitiParts[filename];
    if (!data) {
      throw new Error('Bad multipart body parsing: no data file found!');
    }
    
    filesController.createFile(config, filename, data, 'multipart/form-data').then((result) => {
      res.status(200);
      res.set('Location', result.url);
      res.json(result);
    }).catch((e) => {
      logger.error(e.message, e);
      next(new Parse.Error(Parse.Error.FILE_SAVE_ERROR, 'Could not store file.'));
    });
  }

  createHandler(req, res, next) {
    if (!req.body || !req.body.length) {
      next(new Parse.Error(Parse.Error.FILE_SAVE_ERROR,
        'Invalid file upload.'));
      return;
    }

    if (req.params.filename.length > 128) {
      next(new Parse.Error(Parse.Error.INVALID_FILE_NAME,
        'Filename too long.'));
      return;
    }

    if (!req.params.filename.match(/^[_a-zA-Z0-9][a-zA-Z0-9@\.\ ~_-]*$/)) {
      next(new Parse.Error(Parse.Error.INVALID_FILE_NAME,
        'Filename contains invalid characters.'));
      return;
    }

    const filename = req.params.filename;
    const contentType = req.get('Content-type');
    const config = req.config;
    const filesController = config.filesController;

    filesController.createFile(config, filename, req.body, contentType).then((result) => {
      res.status(201);
      res.set('Location', result.url);
      res.json(result);
    }).catch((e) => {
      logger.error(e.message, e);
      next(new Parse.Error(Parse.Error.FILE_SAVE_ERROR, 'Could not store file.'));
    });
  }

  deleteHandler(req, res, next) {
    const filesController = req.config.filesController;
    filesController.deleteFile(req.config, req.params.filename).then(() => {
      res.status(200);
      // TODO: return useful JSON here?
      res.end();
    }).catch(() => {
      next(new Parse.Error(Parse.Error.FILE_DELETE_ERROR,
        'Could not delete file.'));
    });
  }
}

function isFileStreamable(req, filesController){
  if (req.get('Range')) {
    if (!(typeof filesController.adapter.getFileStream === 'function')) {
      return false;
    }
    if (typeof filesController.adapter.constructor.name !== 'undefined') {
      if (filesController.adapter.constructor.name == 'GridStoreAdapter') {
        return true;
      }
    }
  }
  return false;
}

// handleFileStream is licenced under Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/).
// Author: LEROIB at weightingformypizza (https://weightingformypizza.wordpress.com/2015/06/24/stream-html5-media-content-like-video-audio-from-mongodb-using-express-and-gridstore/).
function handleFileStream(stream, req, res, contentType) {
  var buffer_size = 1024 * 1024;//1024Kb
  // Range request, partiall stream the file
  var parts = req.get('Range').replace(/bytes=/, "").split("-");
  var partialstart = parts[0];
  var partialend = parts[1];
  var start = partialstart ? parseInt(partialstart, 10) : 0;
  var end = partialend ? parseInt(partialend, 10) : stream.length - 1;
  var chunksize = (end - start) + 1;

  if (chunksize == 1) {
    start = 0;
    partialend = false;
  }

  if (!partialend) {
    if (((stream.length - 1) - start) < (buffer_size)) {
      end = stream.length - 1;
    }else{
      end = start + (buffer_size);
    }
    chunksize = (end - start) + 1;
  }

  if (start == 0 && end == 2) {
    chunksize = 1;
  }

  res.writeHead(206, {
    'Content-Range': 'bytes ' + start + '-' + end + '/' + stream.length,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunksize,
    'Content-Type': contentType,
  });

  stream.seek(start, function () {
    // get gridFile stream
    var gridFileStream = stream.stream(true);
    var bufferAvail = 0;
    var range = (end - start) + 1;
    var totalbyteswanted = (end - start) + 1;
    var totalbyteswritten = 0;
    // write to response
    gridFileStream.on('data', function (buff) {
      bufferAvail += buff.length;
      //Ok check if we have enough to cover our range
      if (bufferAvail < range) {
        //Not enough bytes to satisfy our full range
        if (bufferAvail > 0) {
          //Write full buffer
          res.write(buff);
          totalbyteswritten += buff.length;
          range -= buff.length;
          bufferAvail -= buff.length;
        }
      } else {
        //Enough bytes to satisfy our full range!
        if (bufferAvail > 0) {
          const buffer = buff.slice(0,range);
          res.write(buffer);
          totalbyteswritten += buffer.length;
          bufferAvail -= range;
        }
      }
      if (totalbyteswritten >= totalbyteswanted) {
        //totalbytes = 0;
        stream.close();
        res.end();
        this.destroy();
      }
    });
  });
}

function Header_parse(header) {
  var headerFields = {};
  var matchResult = header.match(/^.*name="([^"]*)"$/);
  if (matchResult) {
    headerFields.name = matchResult[1];
  }
  return headerFields;
}

function rawStringToBuffer(str) {
  var idx, len = str.length,
    arr = new Array(len);
  for (idx = 0; idx < len; ++idx) {
    arr[idx] = str.charCodeAt(idx) & 0xFF;
  }
  return new Buffer(arr);
}

function handleCodePoints(array) {
  var CHUNK_SIZE = 0x8000; // arbitrary number here, not too small, not too big
  var index = 0;
  var length = array.length;
  var result = '';
  var slice;
  while (index < length) {
    slice = array.slice(index, Math.min(index + CHUNK_SIZE, length)); // `Math.min` is not really necessary here I think
    result += String.fromCharCode.apply(null, slice);
    index += CHUNK_SIZE;
  }
  return result;
}
/*
 * MultiPart_parse decodes a multipart/form-data encoded response into a named-part-map.
 * The response can be a string or raw bytes.
 *
 * Usage for string response:
 *      var map = MultiPart_parse(xhr.responseText, xhr.getResponseHeader('Content-Type'));
 *
 * Usage for raw bytes:
 *      xhr.open(..);
 *      xhr.responseType = "arraybuffer";
 *      ...
 *      var map = MultiPart_parse(xhr.response, xhr.getResponseHeader('Content-Type'));
 *
 * TODO: Can we use https://github.com/felixge/node-formidable
 * See http://stackoverflow.com/questions/6965107/converting-between-strings-and-arraybuffers
 * See http://www.w3.org/Protocols/rfc1341/7_2_Multipart.html
 *
 * Copyright@ 2013-2014 Wolfgang Kuehn, released under the MIT license.
*/
function MultiPart_parse(body, contentType) {
  // Examples for content types:
  //      multipart/form-data; boundary="----7dd322351017c"; ...
  //      multipart/form-data; boundary=----7dd322351017c; ...
  var m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  if (!m) {
    throw new Error('Bad content-type header, no multipart boundary');
  }

  var boundary = m[1] || m[2];

  // \r\n is part of the boundary.
  boundary = '\r\n--' + boundary;

  var isRaw = typeof(body) !== 'string';

  var s = null;
  if (isRaw) {
    //s = body.toString('utf-8');
    var view = new Uint8Array(body);
    s = handleCodePoints(view);
  } else {
    s = body;
  }
  // console.log('shang:MultiPart_parse:s:' + s);
  // Prepend what has been stripped by the body parsing mechanism.
  s = '\r\n' + s;

  // don't use RegExp here, since WX boundary someime with a '+' sign like this:'--WABoundary+D110BF680595D4AEWA'
  // var parts = s.split(new RegExp(boundary)), 
  var parts = s.split(boundary),
    partsByName = {};

  var fieldName = null;
  // First part is a preamble, last part is closing '--'
  for (var i = 1; i < parts.length - 1; i++) {
    var subparts = parts[i].split('\r\n\r\n');
    var headers = subparts[0].split('\r\n');
    for (var j = 1; j < headers.length; j++) {
      var headerFields = Header_parse(headers[j]);
      if (headerFields.name) {
        fieldName = headerFields.name;
      }
    }
    //console.log('shang:MultiPart_parse:fieldName:' + JSON.stringify(fieldName));
    //console.log('shang:MultiPart_parse:headers:' + JSON.stringify(headers));
    //console.log('shang:MultiPart_parse:subparts:' + JSON.stringify(subparts));
    //console.log('shang:MultiPart_parse:subparts[1]:' + subparts[1].length);
    //console.log('shang:MultiPart_parse:rawStringToBuffer(subparts[1]):' + rawStringToBuffer(subparts[1]).length);

    partsByName[fieldName] = isRaw ? rawStringToBuffer(subparts[1]) : subparts[1];
  }

  return partsByName;
}
