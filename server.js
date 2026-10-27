require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const CachedProfile = require('./models/CachedProfile');
const app = express();
app.use(express.json());
app.use(express.static('public'));

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected'))
    .catch((error) => console.error('MongoDB connection error:', error));

app.get('/api/profile/:username', async (req, res) => {
    try {
        const { username } = req.params;

        const response = await axios.get(`https://api.github.com/users/${username}`);
        const data = response.data;

        res.json({
            username: data.login,
            name: data.name,
            avatar: data.avatar_url,
            bio: data.bio,
            followers: data.followers,
            following: data.following,
            publicRepos: data.public_repos,
            createdAt: data.created_at,
            profileUrl: data.html_url
        });

    } catch (error) {
        if (error.response && error.response.status === 404) {
            return res.status(404).json({ error: 'GitHub user not found' });
        }
        console.error('Error fetching GitHub profile:', error.message);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});
app.get('/api/repos/:username', async (req, res) => {
    try {
        const { username } = req.params;

        const response = await axios.get(
            `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`
        );
        const repos = response.data;

        let totalStars = 0;
        const languageCounts = {};

        repos.forEach(repo => {
            totalStars += repo.stargazers_count;

            if (repo.language) {
                languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
            }
        });

        const languages = Object.entries(languageCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        const topRepos = [...repos]
            .sort((a, b) => b.stargazers_count - a.stargazers_count)
            .slice(0, 5)
            .map(repo => ({
                name: repo.name,
                stars: repo.stargazers_count,
                description: repo.description,
                url: repo.html_url,
                language: repo.language
            }));

        res.json({
            totalRepos: repos.length,
            totalStars,
            languages,
            topRepos
        });

    } catch (error) {
        if (error.response && error.response.status === 404) {
            return res.status(404).json({ error: 'GitHub user not found' });
        }
        console.error('Error fetching repos:', error.message);
        res.status(500).json({ error: 'Failed to fetch repos' });
    }
});
app.get('/api/contributions/:username', async (req, res) => {
    try {
        const { username } = req.params;

        const query = `
            query($username: String!) {
                user(login: $username) {
                    contributionsCollection {
                        contributionCalendar {
                            totalContributions
                            weeks {
                                contributionDays {
                                    date
                                    contributionCount
                                }
                            }
                        }
                    }
                }
            }
        `;

        const response = await axios.post(
            'https://api.github.com/graphql',
            { query, variables: { username } },
            {
                headers: {
                    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`
                }
            }
        );

        if (response.data.errors) {
            return res.status(404).json({ error: 'GitHub user not found' });
        }

        const calendar = response.data.data.user.contributionsCollection.contributionCalendar;

        const days = calendar.weeks.flatMap(week => week.contributionDays);

        let currentStreak = 0;
        for (let i = days.length - 1; i >= 0; i--) {
            if (days[i].contributionCount > 0) {
                currentStreak++;
            } else {
                break;
            }
        }

        res.json({
            totalContributions: calendar.totalContributions,
            currentStreak,
            days
        });

    } catch (error) {
        console.error('Error fetching contributions:', error.message);
        res.status(500).json({ error: 'Failed to fetch contribution data' });
    }
});
app.get('/api/dashboard/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const ONE_HOUR = 60 * 60 * 1000;

        const cached = await CachedProfile.findOne({ username: username.toLowerCase() });

        if (cached && (Date.now() - cached.fetchedAt.getTime()) < ONE_HOUR) {
            return res.json({ ...cached.data, cached: true });
        }

        const [profileRes, reposRes, contribRes] = await Promise.all([
            axios.get(`https://api.github.com/users/${username}`),
            axios.get(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`),
            axios.post(
                'https://api.github.com/graphql',
                {
                    query: `query($username: String!) { user(login: $username) { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`,
                    variables: { username }
                },
                { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } }
            )
        ]);

        const profileData = profileRes.data;
        const repos = reposRes.data;

        let totalStars = 0;
        const languageCounts = {};
        repos.forEach(repo => {
            totalStars += repo.stargazers_count;
            if (repo.language) {
                languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
            }
        });

        const languages = Object.entries(languageCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count);

        const topRepos = [...repos]
            .sort((a, b) => b.stargazers_count - a.stargazers_count)
            .slice(0, 5)
            .map(repo => ({
                name: repo.name,
                stars: repo.stargazers_count,
                description: repo.description,
                url: repo.html_url,
                language: repo.language
            }));

        const calendar = contribRes.data.data.user.contributionsCollection.contributionCalendar;
        const days = calendar.weeks.flatMap(week => week.contributionDays);

        let currentStreak = 0;
        for (let i = days.length - 1; i >= 0; i--) {
            if (days[i].contributionCount > 0) {
                currentStreak++;
            } else {
                break;
            }
        }

        const dashboardData = {
            username: profileData.login,
            name: profileData.name,
            avatar: profileData.avatar_url,
            bio: profileData.bio,
            followers: profileData.followers,
            publicRepos: profileData.public_repos,
            totalStars,
            languages,
            topRepos,
            totalContributions: calendar.totalContributions,
            currentStreak,
            days
        };

        await CachedProfile.findOneAndUpdate(
            { username: username.toLowerCase() },
            { username: username.toLowerCase(), data: dashboardData, fetchedAt: new Date() },
            { upsert: true }
        );

        res.json({ ...dashboardData, cached: false });

    } catch (error) {
        if (error.response && error.response.status === 404) {
            return res.status(404).json({ error: 'GitHub user not found' });
        }
        console.error('Error building dashboard:', error.message);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});