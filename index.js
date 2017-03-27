const usefulFileTypes = ['tif', 'jpg'];
const directoryA = '/Users/foo/Desktop/without-id';
const directoryB = '/Users/foo/Desktop/with-id';
const tempDirectory = '/Users/foo/Desktop/temp'; // Must exist

const _ = require('lodash');
const async = require('async');
const crypto = require('crypto');
const fs = require('fs');
const gm = require('gm');
const path = require('path');

const filesInA = fs.readdirSync(directoryA);
const filesInB = fs.readdirSync(directoryB);


const checkDimensionsEquality = (a, b) => _.every(
  (['width', 'height']),
  dimension => _.floor(a[dimension] / 8) === _.floor(b[dimension] / 8));


const getRenameCore = (result) => {
  const [titleA, typeA] = _.split(result.fileNameFromA, '.');
  const [titleB, typeB] = _.split(result.fileNameFromB, '.');
  if (_.startsWith(titleA, 'artworkCJ') || _.startsWith(titleA, 'A_0') || _.startsWith(titleA, 'JACK')) {
    if (_.endsWith(titleB, titleA)) { return titleB; }
    return `${titleB}_${titleA}`;
  }
  if (_.startsWith(titleB, 'artworkCJ') || _.startsWith(titleB, 'A_0') || _.startsWith(titleB, 'JACK')) {
    if (_.endsWith(titleA, titleB)) { return titleA; }
    return `${titleA}_${titleB}`;
  }
  if (titleA.length > titleB.length) {
    return titleA;
  }
  return titleB;
};

const suggestRename = result => _(getRenameCore(result))
  .chain()
  .replace('A_0', 'A00')
  .replace(' ', '_')
  .value();

const getResizedImage = (directory, filename) => new Promise((resolve, reject) => {
  if (!_.isString(directory) || !_.isString(filename)) { return resolve(''); }
  const hash = crypto.createHash('sha256');
  hash.update(directory + filename);
  const hashedName = hash.digest('hex');
  const fileName = `${tempDirectory}/${hashedName}.jpg`;
  if (fs.existsSync(fileName)) {
    return resolve(fileName);
  }

  gm(path.join(directory, filename))
      .scale(200, 200)
      .write(
        fileName,
        (err) => {
          if (err) {
            return reject(err);
          }
          return resolve(fileName);
        });
});

const getImageSize = thumbnailPath => new Promise((resolve, reject) => {
  gm(thumbnailPath).size((err, value) => {
    if (err) {
      return reject(err);
    }
    return resolve(value);
  });
});


const getHtml = (result) => {
  const newTitle = suggestRename(result);
  const [titleA, typeA] = _.split(result.fileNameFromA, '.');
  const [titleB, typeB] = _.split(result.fileNameFromB, '.');
  return Promise.all([
    getResizedImage(directoryA, result.fileNameFromA),
    getResizedImage(directoryB, result.fileNameFromB),
  ]).then(([thumbnailA, thumbnailB]) => {
    if (!_.has(result, 'equality') || titleA === titleB) { return ''; }

    // if (result.equality > 0.0143677179) {return ''}

    const aFrom = path.join(directoryA, (result.fileNameFromA || ''));
    const aTo = path.join(directoryA, `${newTitle}.${typeA}`);

    const bFrom = path.join(directoryB, (result.fileNameFromB || ''));
    const bTo = path.join(directoryB, `${newTitle}.${typeA}`);

    const aRename = aFrom !== aTo ? `fs.renameSync("${aFrom}", "${aTo}");` : '';
    const bRename = bFrom !== bTo ? `fs.renameSync("${bFrom}", "${bTo}");` : '';

    // Switch return statements to render just the node commands to rename.

    // return aRename + bRename;

    return `
        <img src="file://${thumbnailA}"/>
        <img src="file://${thumbnailB}"/>
        <pre>${JSON.stringify(result, null, 2)}</pre>
        <pre>Suggested Title: ${newTitle}</pre>
        <code style='background-color: black; color: white; padding: 2rem; display: block;'>
          ${aRename}
          ${bRename}
        </code>
        <br/>
        <br/>
      `;
  }).catch((err) => { console.log(err); });
};


const fileAProcessor = fileNameFromA => (cb) => {
  const [titleA, typeA] = _.split(fileNameFromA, '.');
  if (!_.includes(usefulFileTypes, typeA)) { return cb(); }

  const fileBProcessor = fileNameFromB => (cb2) => {
    const [titleB, typeB] = _.split(fileNameFromB, '.');
    if (!_.includes(usefulFileTypes, typeB)) { return cb2(); }
    if (titleA === titleB) { return cb2(null, { equality: 0, fileNameFromB }); }

    Promise.all([
      getResizedImage(directoryA, fileNameFromA),
      getResizedImage(directoryB, fileNameFromB),
    ])
      .then(([thumbnailA, thumbnailB]) => {
        Promise.all([
          getImageSize(thumbnailA),
          getImageSize(thumbnailB),
        ])
        .then(([sizeA, sizeB]) => {
          if (!_.isEqual(sizeA, sizeB, checkDimensionsEquality)) { return cb2(); }

          gm.compare(
            thumbnailA,
            thumbnailB,
            (err, isEqual, equality) => { // 0 is a perfect match.
              if (err) { return cb2(err); }

              return cb2(null, { equality, fileNameFromB });
            });
        })
        .catch(cb2);
      })
      .catch(cb2);
  };

  async.parallelLimit(
    _.map(filesInB, fileBProcessor),
    1,
    (err, results) => cb(
      err,
      _.extend({}, _(results)
        .compact()
        .sortBy('equality')
        .head(), { fileNameFromA }
      )
    )
  );
};


// Process the folders.
async.parallelLimit(_.map(filesInA, fileAProcessor), 2, (err, results) => {
  if (err) { return console.log(err); }
  const resultsTransformed = _(results).compact().sortBy('equality').value();
  fs.writeFileSync('/Users/Foo/Desktop/diff-output.json', JSON.stringify(resultsTransformed, null, 2));

  Promise.all(_.map(resultsTransformed, getHtml))
  .then((htmlArray) => {
    const htmlIsh = htmlArray.join('');
    fs.writeFileSync('/Users/Foo/Desktop/diff-output.htm', htmlIsh);
    console.log('Done!');
  })
  .catch(err => console.log(err));
});

// Just read the JSON we created in the previous run, and re-build the HTML.
// const jsonFromFile = fs.readFileSync('/Users/Foo/Desktop/diff-output.json');
// const resultsTransformed = JSON.parse(jsonFromFile);
// Promise.all(_.map(resultsTransformed, getHtml))
// .then((htmlArray) => {
//   const htmlIsh = htmlArray.join('');
//   fs.writeFileSync('/Users/Foo/Desktop/diff-output.htm', htmlIsh);
//   console.log('Done!');
// });
