#  Vrijeme Weather App 🌦️

<p align="center">
  </p>

<p align="center">
  A clean, modern, and responsive weather dashboard built with React.
</p>

<p align="center">
  <img src="./public/image.png" alt="Vrijeme App Screenshot" width="100%"/>
</p>

## About The Project

**Vrijeme** (Bosnian/Croatian/Serbian for "Weather") is a frontend-only React application that provides real-time weather data and a 3-day forecast for any city. It's designed to be simple, fast, and visually appealing, with a dynamic UI that changes based on the weather conditions and time of day.

This project was built to demonstrate proficiency in:
* React Hooks (`useState`, `useEffect`)
* Fetching data from a third-party API
* Component-based UI design
* Responsive styling with Tailwind CSS
* Using browser `localStorage` to persist data

---

## ✨ Key Features

* ☀️ **Current Weather:** Get up-to-the-minute details, including temperature, "feels like" temperature, humidity, and wind speed.
* 📅 **3-Day Forecast:** Plan ahead with a simple forecast showing highs, lows, and weather conditions.
* 🔍 **Global City Search:** Find the weather for any location in the world.
* 💾 **Saved Location:** The app remembers your last searched city and loads it automatically on your next visit.
* 🎨 **Dynamic UI:** The background gradient and weather icons change to match the current conditions (e.g., sunny, rainy, cloudy, night).
* 📱 **Fully Responsive:** Looks great on all devices, from mobile phones to desktops.

---

## 🛠️ Technologies Used

* [React](https://reactjs.org/) - A JavaScript library for building user interfaces.
* [Tailwind CSS](https://tailwindcss.com/) - A utility-first CSS framework for rapid UI development.
* [Lucide React](https://lucide.dev/) - A library of beautiful and simple icons.
* [WeatherAPI.com](https://www.weatherapi.com/) - The free API used to source all weather data.

---

## 🚀 Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

You will need the following software installed on your machine:
* [Node.js](https://nodejs.org/en/) (v18 or newer recommended)
* [npm](https://www.npmjs.com/) (comes with Node.js)

1. Clone the Repository

Clone this project's repository to your local machine:

git clone [https://github.com/your-username/vrijeme-weather-app.git](https://github.com/your-username/vrijeme-weather-app.git)
cd vrijeme-weather-app


2. Install Dependencies

Install all the necessary npm packages:

npm install
npm install lucide-react


3. Set Up Your API Key

This project requires a free API key from WeatherAPI.com.

Go to WeatherAPI.com and sign up for a free plan.

Once you have your API key, open the project in your code editor.

Navigate to the main React component file (e.g., src/WeatherDashboard.jsx or src/App.jsx).

Find the following line of code:

const API_KEY = 'YOUR_API_KEY_HERE';


Replace 'YOUR_API_KEY_HERE' with your actual API key (keep the quotes).

4. Run the Application

Start the local development server:

npm start


(Or npm run dev if you are using a tool like Vite)

Open http://localhost:3000 (or the port shown in your terminal) in your browser to see the app.

📄 License

This project is open-source and available under the MIT License.

Acknowledgements

Data provided by WeatherAPI.com

Icons by Lucide