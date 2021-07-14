'use strict';

/**
 * Read the documentation (https://strapi.io/documentation/developer-docs/latest/concepts/services.html#core-services)
 * to customize this service
 */

const axios = require('axios');
const slugify = require('slugify');
const qs = require('querystring');

function Exception(e) {
  return { e, data: e.data && e.data.errors };
}

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getGameInfo(slug) {
  try {
    const jsdom = require('jsdom');
    const { JSDOM } = jsdom;
    const body = await axios.get(`https://www.gog.com/game/${slug}`);
    const dom = new JSDOM(body.data);

    const description = dom.window.document.querySelector('.description');

    return {
      rating: 'FREE',
      short_description: description.textContent.slice(0, 160),
      description: description.innerHTML,
    };
  } catch (error) {
    console.log('getGameInfo', Exception(error));
  }
}

async function getByName(name, entityName) {
  const item = await strapi.services[entityName].find({ name });

  return item.length ? item[0] : null;
}

async function create(name, entityName) {
  try {
    const item = await getByName(name, entityName);

    if (!item) {
      const currentName = name.toLowerCase().replace(/[^a-zA-Z0-9 ]/, '');
      const slug = String(currentName).replace(/ /g, '');
      return await strapi.services[entityName].create({
        name,
        slug: slugify(slug),
      });
    }
  } catch (error) {
    console.log('getByName', Exception(error));
  }
}

async function createManyToManyData(products) {
  const developers = {};
  const publishers = {};
  const categories = {};
  const platforms = {};

  products.forEach((product) => {
    const { developer, publisher, genres, supportedOperatingSystems } = product;

    genres &&
      genres.forEach((item) => {
        categories[item] = true;
      });

    supportedOperatingSystems &&
      supportedOperatingSystems.forEach((item) => {
        platforms[item] = true;
      });

    developers[developer] = true;
    publishers[publisher] = true;
  });

  return Promise.all([
    ...Object.keys(developers).map((name) => create(name, 'developer')),
    ...Object.keys(publishers).map((name) => create(name, 'publisher')),
    ...Object.keys(categories).map((name) => create(name, 'category')),
    ...Object.keys(platforms).map((name) => create(name, 'platform')),
  ]);
}

async function createGames(products) {
  try {
    await Promise.all(
      products.map(async (product) => {
        const item = await getByName(product.title, 'game');

        if (!item) {
          console.info(`Creating: ${product.title}...`);
          const currentGame = await strapi.services.game.create({
            name: product.title,
            slug: product.slug.replace(/_/g, '-'),
            price: product.price.amount,
            release_date: new Date(
              Number(product.globalReleaseDate) * 1000
            ).toISOString(),
            categories: await Promise.all(
              product.genres.map((name) => getByName(name, 'category'))
            ),
            platforms: await Promise.all(
              product.supportedOperatingSystems.map((name) =>
                getByName(name, 'platform')
              )
            ),
            developers: [await getByName(product.developer, 'developer')],
            publisher: await getByName(product.publisher, 'publisher'),
            ...(await getGameInfo(product.slug)),
          });

          await setImage({ image: product.image, currentGame });

          await Promise.all(
            product.gallery
              .slice(0, 5)
              .map((url) =>
                setImage({ image: url, currentGame, field: 'gallery' })
              )
          );

          await timeout(2000);
          return currentGame;
        }
      })
    );
  } catch (error) {
    console.log('createGames', Exception(error));
  }
}

async function setImage({ image, game, field = 'cover' }) {
  try {
    const url = `https:${image}_bg_crop_16080x655.jpg`;
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(data, 'base64');

    const FormData = require('form-data');
    const formData = new FormData();

    formData.append('refId', game.id);
    formData.append('ref', 'game');
    formData.append('field', field);
    formData.append('files', buffer, { filename: `${game.slug}.jpg` });

    console.info(`Uploading ${field} image: ${game.slug}.jpg`);

    await axios({
      method: 'POST',
      url: `http://${strapi.config.host}:${strapi.config.port}/upload`,
      data: formData,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
      },
    });
  } catch (error) {
    console.log('setImage', Exception(error));
  }
}

module.exports = {
  populate: async (params) => {
    console.log('Chamando o serviço populate');
    const gogApiUrl = `https://www.gog.com/games/ajax/filtered?mediaType=game&page=1&sort=popularity&${qs.stringify(params)}`;

    const {
      data: { products },
    } = await axios.get(gogApiUrl);

    await createManyToManyData(products);
    await createGames(products);
  },
};